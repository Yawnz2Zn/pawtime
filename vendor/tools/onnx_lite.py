"""Tiny, dependency-free ONNX reader (protobuf wire format) - just enough for convolutional nets.
Used to convert u2netp.onnx into a simple graph.json + weights.bin that the browser runner reads.
"""
import struct
import numpy as np

def _varint(b, i):
    r = 0; s = 0
    while True:
        c = b[i]; i += 1
        r |= (c & 0x7F) << s
        if not c & 0x80: return r, i
        s += 7

def _fields(b):
    """yield (field_number, wire_type, value) for a protobuf message (bytes)."""
    i = 0; n = len(b)
    while i < n:
        key, i = _varint(b, i)
        f, w = key >> 3, key & 7
        if w == 0:
            v, i = _varint(b, i)
        elif w == 1:
            v = b[i:i + 8]; i += 8
        elif w == 2:
            l, i = _varint(b, i); v = b[i:i + l]; i += l
        elif w == 5:
            v = b[i:i + 4]; i += 4
        else:
            raise ValueError(f"wire type {w}")
        yield f, w, v

def _packed_varints(b):
    out = []; i = 0
    while i < len(b):
        v, i = _varint(b, i); out.append(v)
    return out

def _signed(v):  # int64 as unsigned varint -> signed
    return v - (1 << 64) if v >= (1 << 63) else v

DTYPES = {1: np.float32, 6: np.int32, 7: np.int64, 10: np.float16, 11: np.float64}

def parse_tensor(b):
    dims = []; dt = 1; name = ''; raw = None; fdata = []; idata = []
    for f, w, v in _fields(b):
        if f == 1:
            dims += _packed_varints(v) if w == 2 else [v]
        elif f == 2: dt = v
        elif f == 4: fdata += list(struct.unpack('<%df' % (len(v) // 4), v)) if w == 2 else [struct.unpack('<f', v)[0]]
        elif f == 7: idata += [_signed(x) for x in (_packed_varints(v) if w == 2 else [v])]
        elif f == 8: name = v.decode()
        elif f == 9: raw = v
    np_dt = DTYPES[dt]
    if raw is not None: arr = np.frombuffer(raw, dtype=np_dt)
    elif fdata: arr = np.array(fdata, dtype=np_dt)
    else: arr = np.array(idata, dtype=np_dt)
    return name, arr.reshape([int(d) for d in dims]) if dims else arr.reshape(())

def parse_attr(b):
    name = ''; typ = 0; val = {}
    for f, w, v in _fields(b):
        if f == 1: name = v.decode()
        elif f == 2: val['f'] = struct.unpack('<f', v)[0]
        elif f == 3: val['i'] = _signed(v)
        elif f == 4: val['s'] = v.decode(errors='replace')
        elif f == 5: val['t'] = parse_tensor(v)[1]
        elif f == 7: val.setdefault('floats', []).extend(struct.unpack('<%df' % (len(v) // 4), v) if w == 2 else [struct.unpack('<f', v)[0]])
        elif f == 8: val.setdefault('ints', []).extend([_signed(x) for x in _packed_varints(v)] if w == 2 else [_signed(v)])
        elif f == 20: typ = v
    # type: 1 FLOAT 2 INT 3 STRING 4 TENSOR 6 FLOATS 7 INTS
    pick = {1: 'f', 2: 'i', 3: 's', 4: 't', 6: 'floats', 7: 'ints'}.get(typ)
    return name, val.get(pick, val.get('ints', val.get('floats')))

def parse_node(b):
    n = {'input': [], 'output': [], 'op': '', 'name': '', 'attrs': {}}
    for f, w, v in _fields(b):
        if f == 1: n['input'].append(v.decode())
        elif f == 2: n['output'].append(v.decode())
        elif f == 3: n['name'] = v.decode()
        elif f == 4: n['op'] = v.decode()
        elif f == 5:
            k, val = parse_attr(v); n['attrs'][k] = val
    return n

def parse_valueinfo_name(b):
    for f, w, v in _fields(b):
        if f == 1: return v.decode()

def load(path):
    data = open(path, 'rb').read()
    model = {'opset': [], 'graph': None}
    graph = {'nodes': [], 'inits': {}, 'inputs': [], 'outputs': []}
    for f, w, v in _fields(data):
        if f == 8:
            ver = 0
            for ff, ww, vv in _fields(v):
                if ff == 2: ver = vv
            model['opset'].append(ver)
        elif f == 7:
            for gf, gw, gv in _fields(v):
                if gf == 1: graph['nodes'].append(parse_node(gv))
                elif gf == 5:
                    nm, arr = parse_tensor(gv); graph['inits'][nm] = arr
                elif gf == 11: graph['inputs'].append(parse_valueinfo_name(gv))
                elif gf == 12: graph['outputs'].append(parse_valueinfo_name(gv))
    model['graph'] = graph
    return model
