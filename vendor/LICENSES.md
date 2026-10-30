# Third-party material in this folder

| File | What it is | Source and licence |
|---|---|---|
| `u2netp.bin`, `u2netp.json` | The **U²-Net-P** cut-out model (weights + layer plan). Used to find the pet in a photo. | Model by Xuebin Qin et al., https://github.com/xuebinqin/U-2-Net, **Apache License 2.0**. The ONNX export used as the starting point is from the **rembg** project (https://github.com/danielgatis/rembg, **MIT**). |
| `conv.wasm`, `conv.c` | A small WebAssembly SIMD convolution kernel (my own code, compiled with clang). | Written for this project. |
| `u2net-engine.js` | A tiny runner that executes the model in the browser (my own code, no AI library). | Written for this project. |
| `tools/` | Python scripts that converted the ONNX file into `u2netp.json` / `u2netp.bin` and built `conv.wasm`. | Written for this project. |

The model runs fully on the device. No photo is uploaded anywhere.
