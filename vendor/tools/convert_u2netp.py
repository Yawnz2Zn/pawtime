"""Convert u2netp.onnx (U^2-Net-P, Apache-2.0, ONNX export from the rembg project) into
  vendor/u2netp.json  - a size-independent layer plan (conv / pool / resize / concat / add / sigmoid)
  vendor/u2netp.bin   - all convolution weights + biases as little-endian float32
so the app can run the network in plain JavaScript with no runtime library.

Only the first model output (the fused saliency map) is kept; everything it does not need is pruned.
"""
import json, sys, math
import numpy as np
sys.path.insert(0, __file__.rsplit('/', 1)[0])
import onnx_lite as ol

src, out_dir = sys.argv[1], sys.argv[2]
m = ol.load(src)
g = m['graph']
inits = dict(g['inits'])
nodes = g['nodes']
in_name = [i for i in g['inputs'] if i not in inits][0]
out_name = g['outputs'][0]

# ---- evaluate shape-only constant subgraphs symbolically; remember which tensors' shapes they depend on
const = dict(inits)           # name -> ndarray
deps = {}                     # const name -> set of activation tensor names whose *shape* it depends on
shape = {in_name: None}       # activation name -> (C,H,W) placeholder; H,W are symbolic at runtime
act_nodes = []                # activation ops in order

def is_const(n): return n in const

for n in nodes:
    op, ins, outs, a = n['op'], n['input'], n['output'], n['attrs']
    if op == 'Constant':
        const[outs[0]] = a['value']; deps[outs[0]] = set(); continue
    if op == 'Shape':
        const[outs[0]] = np.array([0, 0, 0, 0], dtype=np.int64)  # values unused; only provenance matters
        deps[outs[0]] = {ins[0]}; continue
    if all((i == '' or is_const(i)) for i in ins) and op in ('Gather', 'Unsqueeze', 'Slice', 'Cast', 'Concat'):
        d = set()
        for i in ins:
            d |= deps.get(i, set())
        const[outs[0]] = np.zeros(1, dtype=np.int64); deps[outs[0]] = d; continue
    act_nodes.append(n)

# ---- prune to what out_name needs
needed = {out_name}
keep = []
for n in reversed(act_nodes):
    if any(o in needed for o in n['output']):
        keep.append(n)
        for i in n['input']:
            if i and not is_const(i): needed.add(i)
keep.reverse()

# ---- fuse conv -> relu
consumers = {}
for n in keep:
    for i in n['input']:
        consumers.setdefault(i, []).append(n)
fused_relu = set()
relu_skip = {}
for n in keep:
    if n['op'] == 'Relu':
        prod = [p for p in keep if n['input'][0] in p['output']]
        if prod and prod[0]['op'] == 'Conv' and len(consumers.get(n['input'][0], [])) == 1:
            fused_relu.add(id(prod[0])); relu_skip[id(n)] = prod[0]['output'][0]

# ---- emit plan
tid = {}
def T(name):
    if name not in tid: tid[name] = len(tid)
    return tid[name]

weights = []
woff = 0
def add_w(arr):
    global woff
    flat = np.ascontiguousarray(arr, dtype='<f4').ravel()
    weights.append(flat)
    o = woff; woff += flat.size
    return o

plan = []
T(in_name)
alias = {}   # relu output name -> conv output name (relu fused)
def R(name):
    while name in alias: name = alias[name]
    return name

for n in keep:
    op, ins, outs, a = n['op'], n['input'], n['output'], n['attrs']
    if op == 'Relu' and id(n) in relu_skip:
        alias[outs[0]] = relu_skip[id(n)]; continue
    if op == 'Conv':
        W = const[ins[1]]; B = const[ins[2]] if len(ins) > 2 and ins[2] else np.zeros(W.shape[0], dtype=np.float32)
        oc, ic, kh, kw = W.shape
        assert a.get('group', 1) == 1
        dil = a.get('dilations', [1, 1]); pads = a.get('pads', [0, 0, 0, 0]); st = a.get('strides', [1, 1])
        assert st == [1, 1] and dil[0] == dil[1]
        assert pads[0] == pads[2] and pads[1] == pads[3]
        # same-size conv?  pad == dil*(k-1)/2
        assert pads[0] == dil[0] * (kh - 1) // 2 and pads[1] == dil[0] * (kw - 1) // 2, (pads, dil, kh, kw)
        plan.append({'op': 'conv', 'in': T(R(ins[0])), 'out': T(outs[0]), 'oc': oc, 'ic': ic, 'kh': kh, 'kw': kw,
                     'dil': dil[0], 'w': add_w(W), 'bo': add_w(B), 'relu': id(n) in fused_relu})
    elif op == 'Relu':
        plan.append({'op': 'relu', 'in': T(R(ins[0])), 'out': T(outs[0])})
    elif op == 'MaxPool':
        assert a['kernel_shape'] == [2, 2] and a['strides'] == [2, 2] and a.get('ceil_mode', 0) == 1
        plan.append({'op': 'pool', 'in': T(R(ins[0])), 'out': T(outs[0])})
    elif op == 'Resize':
        x = ins[0]; sizes = ins[3]
        like = list(deps[sizes] - {x})
        assert len(like) == 1, (n['name'], deps[sizes], x)
        assert a['mode'] == 'linear' and a['coordinate_transformation_mode'] == 'pytorch_half_pixel'
        plan.append({'op': 'resize', 'in': T(R(x)), 'out': T(outs[0]), 'like': T(R(like[0]))})
    elif op == 'Concat':
        assert a['axis'] == 1
        plan.append({'op': 'concat', 'ins': [T(R(i)) for i in ins], 'out': T(outs[0])})
    elif op == 'Add':
        plan.append({'op': 'add', 'a': T(R(ins[0])), 'b': T(R(ins[1])), 'out': T(outs[0])})
    elif op == 'Sigmoid':
        plan.append({'op': 'sigmoid', 'in': T(R(ins[0])), 'out': T(outs[0])})
    else:
        raise SystemExit('unsupported op ' + op)

final = T(R(out_name))

# ---- liveness: free tensors after their last use
last = {}
TENSOR_KEYS = {'conv': ('in',), 'relu': ('in',), 'pool': ('in',), 'resize': ('in', 'like'),
               'add': ('a', 'b'), 'sigmoid': ('in',), 'concat': ()}
for i, p in enumerate(plan):
    for k in TENSOR_KEYS[p['op']]:
        last[p[k]] = i
    for t in p.get('ins', []): last[t] = i
for i, p in enumerate(plan):
    p['free'] = sorted(t for t, l in last.items() if l == i and t != final)

blob = np.concatenate(weights).astype('<f4')
open(f'{out_dir}/u2netp.bin', 'wb').write(blob.tobytes())
doc = {'name': 'u2netp', 'input': tid[in_name], 'output': final, 'tensors': len(tid), 'ops': plan,
       'mean': [0.485, 0.456, 0.406], 'std': [0.229, 0.224, 0.225], 'weightFloats': int(blob.size)}
json.dump(doc, open(f'{out_dir}/u2netp.json', 'w'), separators=(',', ':'))
print('ops', len(plan), 'tensors', len(tid), 'weights', blob.size, 'floats =', round(blob.size * 4 / 1e6, 2), 'MB')
from collections import Counter
print(Counter(p['op'] for p in plan))
