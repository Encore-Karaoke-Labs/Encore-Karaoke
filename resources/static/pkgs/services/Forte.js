import {
  Html
} from "../../chunk-FX4GTR7E.js";
import {
  __commonJS,
  __toESM
} from "../../chunk-7D4SUZUM.js";

// node_modules/fft.js/lib/fft.js
var require_fft = __commonJS({
  "node_modules/fft.js/lib/fft.js"(exports, module) {
    "use strict";
    function FFT2(size) {
      this.size = size | 0;
      if (this.size <= 1 || (this.size & this.size - 1) !== 0)
        throw new Error("FFT size must be a power of two and bigger than 1");
      this._csize = size << 1;
      var table = new Array(this.size * 2);
      for (var i = 0; i < table.length; i += 2) {
        const angle = Math.PI * i / this.size;
        table[i] = Math.cos(angle);
        table[i + 1] = -Math.sin(angle);
      }
      this.table = table;
      var power = 0;
      for (var t = 1; this.size > t; t <<= 1)
        power++;
      this._width = power % 2 === 0 ? power - 1 : power;
      this._bitrev = new Array(1 << this._width);
      for (var j = 0; j < this._bitrev.length; j++) {
        this._bitrev[j] = 0;
        for (var shift = 0; shift < this._width; shift += 2) {
          var revShift = this._width - shift - 2;
          this._bitrev[j] |= (j >>> shift & 3) << revShift;
        }
      }
      this._out = null;
      this._data = null;
      this._inv = 0;
    }
    module.exports = FFT2;
    FFT2.prototype.fromComplexArray = function fromComplexArray(complex, storage) {
      var res = storage || new Array(complex.length >>> 1);
      for (var i = 0; i < complex.length; i += 2)
        res[i >>> 1] = complex[i];
      return res;
    };
    FFT2.prototype.createComplexArray = function createComplexArray() {
      const res = new Array(this._csize);
      for (var i = 0; i < res.length; i++)
        res[i] = 0;
      return res;
    };
    FFT2.prototype.toComplexArray = function toComplexArray(input, storage) {
      var res = storage || this.createComplexArray();
      for (var i = 0; i < res.length; i += 2) {
        res[i] = input[i >>> 1];
        res[i + 1] = 0;
      }
      return res;
    };
    FFT2.prototype.completeSpectrum = function completeSpectrum(spectrum) {
      var size = this._csize;
      var half = size >>> 1;
      for (var i = 2; i < half; i += 2) {
        spectrum[size - i] = spectrum[i];
        spectrum[size - i + 1] = -spectrum[i + 1];
      }
    };
    FFT2.prototype.transform = function transform(out, data) {
      if (out === data)
        throw new Error("Input and output buffers must be different");
      this._out = out;
      this._data = data;
      this._inv = 0;
      this._transform4();
      this._out = null;
      this._data = null;
    };
    FFT2.prototype.realTransform = function realTransform(out, data) {
      if (out === data)
        throw new Error("Input and output buffers must be different");
      this._out = out;
      this._data = data;
      this._inv = 0;
      this._realTransform4();
      this._out = null;
      this._data = null;
    };
    FFT2.prototype.inverseTransform = function inverseTransform(out, data) {
      if (out === data)
        throw new Error("Input and output buffers must be different");
      this._out = out;
      this._data = data;
      this._inv = 1;
      this._transform4();
      for (var i = 0; i < out.length; i++)
        out[i] /= this.size;
      this._out = null;
      this._data = null;
    };
    FFT2.prototype._transform4 = function _transform4() {
      var out = this._out;
      var size = this._csize;
      var width = this._width;
      var step = 1 << width;
      var len = size / step << 1;
      var outOff;
      var t;
      var bitrev = this._bitrev;
      if (len === 4) {
        for (outOff = 0, t = 0; outOff < size; outOff += len, t++) {
          const off = bitrev[t];
          this._singleTransform2(outOff, off, step);
        }
      } else {
        for (outOff = 0, t = 0; outOff < size; outOff += len, t++) {
          const off = bitrev[t];
          this._singleTransform4(outOff, off, step);
        }
      }
      var inv = this._inv ? -1 : 1;
      var table = this.table;
      for (step >>= 2; step >= 2; step >>= 2) {
        len = size / step << 1;
        var quarterLen = len >>> 2;
        for (outOff = 0; outOff < size; outOff += len) {
          var limit = outOff + quarterLen;
          for (var i = outOff, k = 0; i < limit; i += 2, k += step) {
            const A = i;
            const B = A + quarterLen;
            const C = B + quarterLen;
            const D = C + quarterLen;
            const Ar = out[A];
            const Ai = out[A + 1];
            const Br = out[B];
            const Bi = out[B + 1];
            const Cr = out[C];
            const Ci = out[C + 1];
            const Dr = out[D];
            const Di = out[D + 1];
            const MAr = Ar;
            const MAi = Ai;
            const tableBr = table[k];
            const tableBi = inv * table[k + 1];
            const MBr = Br * tableBr - Bi * tableBi;
            const MBi = Br * tableBi + Bi * tableBr;
            const tableCr = table[2 * k];
            const tableCi = inv * table[2 * k + 1];
            const MCr = Cr * tableCr - Ci * tableCi;
            const MCi = Cr * tableCi + Ci * tableCr;
            const tableDr = table[3 * k];
            const tableDi = inv * table[3 * k + 1];
            const MDr = Dr * tableDr - Di * tableDi;
            const MDi = Dr * tableDi + Di * tableDr;
            const T0r = MAr + MCr;
            const T0i = MAi + MCi;
            const T1r = MAr - MCr;
            const T1i = MAi - MCi;
            const T2r = MBr + MDr;
            const T2i = MBi + MDi;
            const T3r = inv * (MBr - MDr);
            const T3i = inv * (MBi - MDi);
            const FAr = T0r + T2r;
            const FAi = T0i + T2i;
            const FCr = T0r - T2r;
            const FCi = T0i - T2i;
            const FBr = T1r + T3i;
            const FBi = T1i - T3r;
            const FDr = T1r - T3i;
            const FDi = T1i + T3r;
            out[A] = FAr;
            out[A + 1] = FAi;
            out[B] = FBr;
            out[B + 1] = FBi;
            out[C] = FCr;
            out[C + 1] = FCi;
            out[D] = FDr;
            out[D + 1] = FDi;
          }
        }
      }
    };
    FFT2.prototype._singleTransform2 = function _singleTransform2(outOff, off, step) {
      const out = this._out;
      const data = this._data;
      const evenR = data[off];
      const evenI = data[off + 1];
      const oddR = data[off + step];
      const oddI = data[off + step + 1];
      const leftR = evenR + oddR;
      const leftI = evenI + oddI;
      const rightR = evenR - oddR;
      const rightI = evenI - oddI;
      out[outOff] = leftR;
      out[outOff + 1] = leftI;
      out[outOff + 2] = rightR;
      out[outOff + 3] = rightI;
    };
    FFT2.prototype._singleTransform4 = function _singleTransform4(outOff, off, step) {
      const out = this._out;
      const data = this._data;
      const inv = this._inv ? -1 : 1;
      const step2 = step * 2;
      const step3 = step * 3;
      const Ar = data[off];
      const Ai = data[off + 1];
      const Br = data[off + step];
      const Bi = data[off + step + 1];
      const Cr = data[off + step2];
      const Ci = data[off + step2 + 1];
      const Dr = data[off + step3];
      const Di = data[off + step3 + 1];
      const T0r = Ar + Cr;
      const T0i = Ai + Ci;
      const T1r = Ar - Cr;
      const T1i = Ai - Ci;
      const T2r = Br + Dr;
      const T2i = Bi + Di;
      const T3r = inv * (Br - Dr);
      const T3i = inv * (Bi - Di);
      const FAr = T0r + T2r;
      const FAi = T0i + T2i;
      const FBr = T1r + T3i;
      const FBi = T1i - T3r;
      const FCr = T0r - T2r;
      const FCi = T0i - T2i;
      const FDr = T1r - T3i;
      const FDi = T1i + T3r;
      out[outOff] = FAr;
      out[outOff + 1] = FAi;
      out[outOff + 2] = FBr;
      out[outOff + 3] = FBi;
      out[outOff + 4] = FCr;
      out[outOff + 5] = FCi;
      out[outOff + 6] = FDr;
      out[outOff + 7] = FDi;
    };
    FFT2.prototype._realTransform4 = function _realTransform4() {
      var out = this._out;
      var size = this._csize;
      var width = this._width;
      var step = 1 << width;
      var len = size / step << 1;
      var outOff;
      var t;
      var bitrev = this._bitrev;
      if (len === 4) {
        for (outOff = 0, t = 0; outOff < size; outOff += len, t++) {
          const off = bitrev[t];
          this._singleRealTransform2(outOff, off >>> 1, step >>> 1);
        }
      } else {
        for (outOff = 0, t = 0; outOff < size; outOff += len, t++) {
          const off = bitrev[t];
          this._singleRealTransform4(outOff, off >>> 1, step >>> 1);
        }
      }
      var inv = this._inv ? -1 : 1;
      var table = this.table;
      for (step >>= 2; step >= 2; step >>= 2) {
        len = size / step << 1;
        var halfLen = len >>> 1;
        var quarterLen = halfLen >>> 1;
        var hquarterLen = quarterLen >>> 1;
        for (outOff = 0; outOff < size; outOff += len) {
          for (var i = 0, k = 0; i <= hquarterLen; i += 2, k += step) {
            var A = outOff + i;
            var B = A + quarterLen;
            var C = B + quarterLen;
            var D = C + quarterLen;
            var Ar = out[A];
            var Ai = out[A + 1];
            var Br = out[B];
            var Bi = out[B + 1];
            var Cr = out[C];
            var Ci = out[C + 1];
            var Dr = out[D];
            var Di = out[D + 1];
            var MAr = Ar;
            var MAi = Ai;
            var tableBr = table[k];
            var tableBi = inv * table[k + 1];
            var MBr = Br * tableBr - Bi * tableBi;
            var MBi = Br * tableBi + Bi * tableBr;
            var tableCr = table[2 * k];
            var tableCi = inv * table[2 * k + 1];
            var MCr = Cr * tableCr - Ci * tableCi;
            var MCi = Cr * tableCi + Ci * tableCr;
            var tableDr = table[3 * k];
            var tableDi = inv * table[3 * k + 1];
            var MDr = Dr * tableDr - Di * tableDi;
            var MDi = Dr * tableDi + Di * tableDr;
            var T0r = MAr + MCr;
            var T0i = MAi + MCi;
            var T1r = MAr - MCr;
            var T1i = MAi - MCi;
            var T2r = MBr + MDr;
            var T2i = MBi + MDi;
            var T3r = inv * (MBr - MDr);
            var T3i = inv * (MBi - MDi);
            var FAr = T0r + T2r;
            var FAi = T0i + T2i;
            var FBr = T1r + T3i;
            var FBi = T1i - T3r;
            out[A] = FAr;
            out[A + 1] = FAi;
            out[B] = FBr;
            out[B + 1] = FBi;
            if (i === 0) {
              var FCr = T0r - T2r;
              var FCi = T0i - T2i;
              out[C] = FCr;
              out[C + 1] = FCi;
              continue;
            }
            if (i === hquarterLen)
              continue;
            var ST0r = T1r;
            var ST0i = -T1i;
            var ST1r = T0r;
            var ST1i = -T0i;
            var ST2r = -inv * T3i;
            var ST2i = -inv * T3r;
            var ST3r = -inv * T2i;
            var ST3i = -inv * T2r;
            var SFAr = ST0r + ST2r;
            var SFAi = ST0i + ST2i;
            var SFBr = ST1r + ST3i;
            var SFBi = ST1i - ST3r;
            var SA = outOff + quarterLen - i;
            var SB = outOff + halfLen - i;
            out[SA] = SFAr;
            out[SA + 1] = SFAi;
            out[SB] = SFBr;
            out[SB + 1] = SFBi;
          }
        }
      }
    };
    FFT2.prototype._singleRealTransform2 = function _singleRealTransform2(outOff, off, step) {
      const out = this._out;
      const data = this._data;
      const evenR = data[off];
      const oddR = data[off + step];
      const leftR = evenR + oddR;
      const rightR = evenR - oddR;
      out[outOff] = leftR;
      out[outOff + 1] = 0;
      out[outOff + 2] = rightR;
      out[outOff + 3] = 0;
    };
    FFT2.prototype._singleRealTransform4 = function _singleRealTransform4(outOff, off, step) {
      const out = this._out;
      const data = this._data;
      const inv = this._inv ? -1 : 1;
      const step2 = step * 2;
      const step3 = step * 3;
      const Ar = data[off];
      const Br = data[off + step];
      const Cr = data[off + step2];
      const Dr = data[off + step3];
      const T0r = Ar + Cr;
      const T1r = Ar - Cr;
      const T2r = Br + Dr;
      const T3r = inv * (Br - Dr);
      const FAr = T0r + T2r;
      const FBr = T1r;
      const FBi = -T3r;
      const FCr = T0r - T2r;
      const FDr = T1r;
      const FDi = T3r;
      out[outOff] = FAr;
      out[outOff + 1] = 0;
      out[outOff + 2] = FBr;
      out[outOff + 3] = FBi;
      out[outOff + 4] = FCr;
      out[outOff + 5] = 0;
      out[outOff + 6] = FDr;
      out[outOff + 7] = FDi;
    };
  }
});

// node_modules/spessasynth_core/dist/index.js
function readBigEndian(dataArray, bytesAmount, offset = 0) {
  let out = 0;
  for (let i = 0; i < bytesAmount; i++) out = out << 8 | dataArray[offset + i];
  return out >>> 0;
}
function readBigEndianIndexed(dataArray, bytesAmount) {
  const res = readBigEndian(dataArray, bytesAmount, dataArray.currentIndex);
  dataArray.currentIndex += bytesAmount;
  return res;
}
function writeBigEndian(number, bytesAmount) {
  const bytes = new Array(bytesAmount).fill(0);
  for (let i = bytesAmount - 1; i >= 0; i--) {
    bytes[i] = number & 255;
    number >>= 8;
  }
  return bytes;
}
function readLittleEndianIndexed(dataArray, bytesAmount) {
  const res = readLittleEndian(dataArray, bytesAmount, dataArray.currentIndex);
  dataArray.currentIndex += bytesAmount;
  return res;
}
function readLittleEndian(dataArray, bytesAmount, offset = 0) {
  let out = 0;
  for (let i = 0; i < bytesAmount; i++) out |= dataArray[offset + i] << i * 8;
  return out >>> 0;
}
function writeLittleEndianIndexed(dataArray, number, byteTarget) {
  for (let i = 0; i < byteTarget; i++) dataArray[dataArray.currentIndex++] = number >> i * 8 & 255;
}
function writeWord(dataArray, word) {
  dataArray[dataArray.currentIndex++] = word & 255;
  dataArray[dataArray.currentIndex++] = word >> 8;
}
function writeDword(dataArray, dword) {
  writeLittleEndianIndexed(dataArray, dword, 4);
}
function signedInt16(byte1, byte2) {
  const val = byte2 << 8 | byte1;
  if (val > 32767) return val - 65536;
  return val;
}
var IndexedByteArray = class extends Uint8Array {
  /**
  * The current index of the array.
  */
  currentIndex = 0;
  /**
  * Returns a section of an array.
  * @param start The beginning of the specified portion of the array.
  * @param end The end of the specified portion of the array. This is exclusive of the element at the index 'end'.
  */
  slice(start, end) {
    const a = super.slice(start, end);
    a.currentIndex = 0;
    return a;
  }
};
function readBinaryString(dataArray, bytes = dataArray.length, offset = 0) {
  let string = "";
  for (let i = 0; i < bytes; i++) {
    const byte = dataArray[offset + i];
    if (byte === 0) return string;
    string += String.fromCharCode(byte);
  }
  return string;
}
function readBinaryStringIndexed(dataArray, bytes) {
  const startIndex = dataArray.currentIndex;
  dataArray.currentIndex += bytes;
  return readBinaryString(dataArray, bytes, startIndex);
}
function getStringBytes(string, addZero = false, ensureEven = false) {
  let len = string.length;
  if (addZero) len++;
  if (ensureEven && len % 2 !== 0) len++;
  const arr = new IndexedByteArray(len);
  writeBinaryStringIndexed(arr, string);
  return arr;
}
function writeBinaryStringIndexed(outArray, string, padLength = 0) {
  if (padLength > 0 && string.length > padLength) string = string.slice(0, padLength);
  for (let i = 0; i < string.length; i++) outArray[outArray.currentIndex++] = string.charCodeAt(i);
  if (padLength > string.length) for (let i = 0; i < padLength - string.length; i++) outArray[outArray.currentIndex++] = 0;
  return outArray;
}
function readVariableLengthQuantity(MIDIbyteArray) {
  let out = 0;
  while (MIDIbyteArray) {
    const byte = MIDIbyteArray[MIDIbyteArray.currentIndex++];
    out = out << 7 | byte & 127;
    if (byte >> 7 !== 1) break;
  }
  return out;
}
function writeVariableLengthQuantity(number) {
  const bytes = [number & 127];
  number >>= 7;
  while (number > 0) {
    bytes.unshift(number & 127 | 128);
    number >>= 7;
  }
  return bytes;
}
function formatTime(totalSeconds) {
  totalSeconds = Math.floor(totalSeconds);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds - minutes * 60);
  return {
    minutes,
    seconds,
    time: `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
  };
}
var consoleColors = {
  warn: "color: orange;",
  unrecognized: "color: red;",
  info: "color: aqua;",
  recognized: "color: lime",
  value: "color: yellow; background-color: black;"
};
var tr;
(() => {
  var l = Uint8Array, T = Uint16Array, ur = Int32Array, W = new l([
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
    1,
    1,
    1,
    2,
    2,
    2,
    2,
    3,
    3,
    3,
    3,
    4,
    4,
    4,
    4,
    5,
    5,
    5,
    5,
    0,
    0,
    0,
    0
  ]), X = new l([
    0,
    0,
    0,
    0,
    1,
    1,
    2,
    2,
    3,
    3,
    4,
    4,
    5,
    5,
    6,
    6,
    7,
    7,
    8,
    8,
    9,
    9,
    10,
    10,
    11,
    11,
    12,
    12,
    13,
    13,
    0,
    0
  ]), wr = new l([
    16,
    17,
    18,
    0,
    8,
    7,
    9,
    6,
    10,
    5,
    11,
    4,
    12,
    3,
    13,
    2,
    14,
    1,
    15
  ]), Y = function(r, a) {
    for (var e = new T(31), f = 0; f < 31; ++f) e[f] = a += 1 << r[f - 1];
    for (var v = new ur(e[30]), f = 1; f < 30; ++f) for (var g = e[f]; g < e[f + 1]; ++g) v[g] = g - e[f] << 5 | f;
    return {
      b: e,
      r: v
    };
  }, Z = Y(W, 2), $ = Z.b, cr = Z.r;
  $[28] = 258, cr[258] = 28;
  var j = Y(X, 0), hr = j.b;
  j.r;
  var _ = new T(32768);
  for (i = 0; i < 32768; ++i) c = (i & 43690) >> 1 | (i & 21845) << 1, c = (c & 52428) >> 2 | (c & 13107) << 2, c = (c & 61680) >> 4 | (c & 3855) << 4, _[i] = ((c & 65280) >> 8 | (c & 255) << 8) >> 1;
  var c, i, A = function(r, a, e) {
    for (var f = r.length, v = 0, g = new T(a); v < f; ++v) r[v] && ++g[r[v] - 1];
    var k = new T(a);
    for (v = 1; v < a; ++v) k[v] = k[v - 1] + g[v - 1] << 1;
    var b;
    if (e) {
      b = new T(1 << a);
      var m = 15 - a;
      for (v = 0; v < f; ++v) if (r[v]) for (var U = v << 4 | r[v], x = a - r[v], n = k[r[v] - 1]++ << x, o = n | (1 << x) - 1; n <= o; ++n) b[_[n] >> m] = U;
    } else for (b = new T(f), v = 0; v < f; ++v) r[v] && (b[v] = _[k[r[v] - 1]++] >> 15 - r[v]);
    return b;
  }, M = new l(288);
  for (i = 0; i < 144; ++i) M[i] = 8;
  var i;
  for (i = 144; i < 256; ++i) M[i] = 9;
  var i;
  for (i = 256; i < 280; ++i) M[i] = 7;
  var i;
  for (i = 280; i < 288; ++i) M[i] = 8;
  var i, L = new l(32);
  for (i = 0; i < 32; ++i) L[i] = 5;
  var i, gr = A(M, 9, 1), br = A(L, 5, 1), q = function(r) {
    for (var a = r[0], e = 1; e < r.length; ++e) r[e] > a && (a = r[e]);
    return a;
  }, u = function(r, a, e) {
    var f = a / 8 | 0;
    return (r[f] | r[f + 1] << 8) >> (a & 7) & e;
  }, C = function(r, a) {
    var e = a / 8 | 0;
    return (r[e] | r[e + 1] << 8 | r[e + 2] << 16) >> (a & 7);
  }, kr = function(r) {
    return (r + 7) / 8 | 0;
  }, xr = function(r, a, e) {
    return (a == null || a < 0) && (a = 0), (e == null || e > r.length) && (e = r.length), new l(r.subarray(a, e));
  }, yr = [
    "unexpected EOF",
    "invalid block type",
    "invalid length/literal",
    "invalid distance",
    "stream finished",
    "no stream handler",
    ,
    "no callback",
    "invalid UTF-8 data",
    "extra field too long",
    "date not in range 1980-2099",
    "filename too long",
    "stream finishing",
    "invalid zip data"
  ], h = function(r, a, e) {
    var f = new Error(a || yr[r]);
    if (f.code = r, Error.captureStackTrace && Error.captureStackTrace(f, h), !e) throw f;
    return f;
  }, Sr = function(r, a, e, f) {
    var v = r.length, g = f ? f.length : 0;
    if (!v || a.f && !a.l) return e || new l(0);
    var k = !e, b = k || a.i != 2, m = a.i;
    k && (e = new l(v * 3));
    var U = function(fr) {
      var or = e.length;
      if (fr > or) {
        var lr = new l(Math.max(or * 2, fr));
        lr.set(e), e = lr;
      }
    }, x = a.f || 0, n = a.p || 0, o = a.b || 0, S = a.l, I = a.d, z = a.m, D = a.n, G = v * 8;
    do {
      if (!S) {
        x = u(r, n, 1);
        var H = u(r, n + 1, 3);
        if (n += 3, H) if (H == 1) S = gr, I = br, z = 9, D = 5;
        else if (H == 2) {
          var N = u(r, n, 31) + 257, s = u(r, n + 10, 15) + 4, d = N + u(r, n + 5, 31) + 1;
          n += 14;
          for (var F = new l(d), P = new l(19), t = 0; t < s; ++t) P[wr[t]] = u(r, n + t * 3, 7);
          n += s * 3;
          for (var rr = q(P), Ar = (1 << rr) - 1, Mr = A(P, rr, 1), t = 0; t < d; ) {
            var ar = Mr[u(r, n, Ar)];
            n += ar & 15;
            var w = ar >> 4;
            if (w < 16) F[t++] = w;
            else {
              var E = 0, O = 0;
              for (w == 16 ? (O = 3 + u(r, n, 3), n += 2, E = F[t - 1]) : w == 17 ? (O = 3 + u(r, n, 7), n += 3) : w == 18 && (O = 11 + u(r, n, 127), n += 7); O--; ) F[t++] = E;
            }
          }
          var er = F.subarray(0, N), y = F.subarray(N);
          z = q(er), D = q(y), S = A(er, z, 1), I = A(y, D, 1);
        } else h(1);
        else {
          var w = kr(n) + 4, J = r[w - 4] | r[w - 3] << 8, K = w + J;
          if (K > v) {
            m && h(0);
            break;
          }
          b && U(o + J), e.set(r.subarray(w, K), o), a.b = o += J, a.p = n = K * 8, a.f = x;
          continue;
        }
        if (n > G) {
          m && h(0);
          break;
        }
      }
      b && U(o + 131072);
      for (var Ur = (1 << z) - 1, zr = (1 << D) - 1, Q = n; ; Q = n) {
        var E = S[C(r, n) & Ur], p = E >> 4;
        if (n += E & 15, n > G) {
          m && h(0);
          break;
        }
        if (E || h(2), p < 256) e[o++] = p;
        else if (p == 256) {
          Q = n, S = null;
          break;
        } else {
          var nr = p - 254;
          if (p > 264) {
            var t = p - 257, B = W[t];
            nr = u(r, n, (1 << B) - 1) + $[t], n += B;
          }
          var R = I[C(r, n) & zr], V = R >> 4;
          R || h(3), n += R & 15;
          var y = hr[V];
          if (V > 3) {
            var B = X[V];
            y += C(r, n) & (1 << B) - 1, n += B;
          }
          if (n > G) {
            m && h(0);
            break;
          }
          b && U(o + 131072);
          var vr = o + nr;
          if (o < y) {
            var ir = g - y, Dr = Math.min(y, vr);
            for (ir + o < 0 && h(3); o < Dr; ++o) e[o] = f[ir + o];
          }
          for (; o < vr; ++o) e[o] = e[o - y];
        }
      }
      a.l = S, a.p = Q, a.b = o, a.f = x, S && (x = 1, a.m = z, a.d = I, a.n = D);
    } while (!x);
    return o != e.length && k ? xr(e, 0, o) : e.subarray(0, o);
  }, Tr = new l(0);
  function mr(r, a) {
    return Sr(r, { i: 2 }, a && a.out, a && a.dictionary);
  }
  var Er = typeof TextDecoder < "u" && new TextDecoder();
  try {
    Er.decode(Tr, { stream: true });
  } catch {
  }
  tr = mr;
})();
var inf = tr;
var ENABLE_INFO = false;
var ENABLE_WARN = true;
var ENABLE_GROUP = false;
function SpessaSynthInfo(...message) {
  if (ENABLE_INFO) console.info(...message);
}
function SpessaSynthWarn(...message) {
  if (ENABLE_WARN) console.warn(...message);
}
function SpessaSynthGroup(...message) {
  if (ENABLE_GROUP) console.group(...message);
}
function SpessaSynthGroupCollapsed(...message) {
  if (ENABLE_GROUP) console.groupCollapsed(...message);
}
function SpessaSynthGroupEnd() {
  if (ENABLE_GROUP) console.groupEnd();
}
var RIFFChunk = class RIFFChunk2 {
  /**
  * The chunks FourCC code.
  */
  header;
  /**
  * Chunk's size, in bytes.
  */
  size;
  /**
  * Chunk's binary data. Note that this will have a length of 0 if "readData" was set to false.
  */
  data;
  /**
  * Creates a new RIFF chunk.
  */
  constructor(header, size, data) {
    this.header = header;
    this.size = size;
    this.data = data;
  }
  /**
  * Reads a RIFF chunk from an array.
  * @param dataArray the array to read from.
  * @param readData if the data should be read as well.
  * @param forceShift if the index should be shifted to the end of the chunk even if the data has not been read.
  */
  static read(dataArray, readData = true, forceShift = false) {
    const header = readBinaryStringIndexed(dataArray, 4);
    let size = readLittleEndianIndexed(dataArray, 4);
    if (header === "") size = 0;
    const chunkData = readData ? dataArray.slice(dataArray.currentIndex, dataArray.currentIndex + size) : new IndexedByteArray(0);
    if (readData || forceShift) {
      dataArray.currentIndex += size;
      if (size % 2 !== 0) dataArray.currentIndex++;
    }
    return new RIFFChunk2(header, size, chunkData);
  }
  /**
  * Writes a RIFF chunk correctly.
  * @param header the fourCC code of the header.
  * @param data the binary chunk data.
  * @param addZeroByte if a zero byte should be at the end of the chunk's data.
  * @param isList if a "LIST" should be set as the chunk type and the actual type should be written at the start of the data.
  * @returns the binary data.
  */
  static write(header, data, addZeroByte = false, isList = false) {
    if (header.length !== 4) throw new Error(`Invalid header length: ${header}`);
    let dataStartOffset = 8;
    let headerWritten = header;
    let dataLength = data.length;
    if (addZeroByte) dataLength++;
    let writtenSize = dataLength;
    if (isList) {
      dataStartOffset += 4;
      writtenSize += 4;
      headerWritten = "LIST";
    }
    let finalSize = dataStartOffset + dataLength;
    if (finalSize % 2 !== 0) finalSize++;
    const outArray = new IndexedByteArray(finalSize);
    writeBinaryStringIndexed(outArray, headerWritten);
    writeDword(outArray, writtenSize);
    if (isList) writeBinaryStringIndexed(outArray, header);
    outArray.set(data, dataStartOffset);
    return outArray;
  }
  /**
  * Writes RIFF chunk given binary blobs.
  * @param header  the fourCC code of the header.
  * @param chunks binary chunk data parts, will be combined in order.
  * @param isList if a "LIST" should be set as the chunk type and the actual type should be written at the start of the data.
  * @returns the binary data
  */
  static writeParts(header, chunks, isList = false) {
    let dataOffset = 8;
    let headerWritten = header;
    const dataLength = chunks.reduce((len, c) => c.length + len, 0);
    let writtenSize = dataLength;
    if (isList) {
      dataOffset += 4;
      writtenSize += 4;
      headerWritten = "LIST";
    }
    let finalSize = dataOffset + dataLength;
    if (finalSize % 2 !== 0) finalSize++;
    const outArray = new IndexedByteArray(finalSize);
    writeBinaryStringIndexed(outArray, headerWritten);
    writeDword(outArray, writtenSize);
    if (isList) writeBinaryStringIndexed(outArray, header);
    for (const c of chunks) {
      outArray.set(c, dataOffset);
      dataOffset += c.length;
    }
    return outArray;
  }
  /**
  * Finds a given type in a list.
  * @remarks
  * Also skips the current index to after the list FourCC.
  */
  static findListType(collection, type) {
    return collection.find((c) => {
      if (c.header !== "LIST") return false;
      c.data.currentIndex = 4;
      return readBinaryString(c.data, 4) === type;
    });
  }
};
function fillWithDefaults(obj, defObj) {
  return {
    ...defObj,
    ...obj
  };
}
var SpessaSynthCoreUtils = {
  consoleColors,
  SpessaSynthInfo,
  SpessaSynthWarn,
  SpessaSynthGroupCollapsed,
  SpessaSynthGroup,
  SpessaSynthGroupEnd,
  readBytesAsUintBigEndian: readBigEndian,
  readLittleEndian: readLittleEndianIndexed,
  readBytesAsString: readBinaryStringIndexed,
  readVariableLengthQuantity,
  inflateSync: inf
};
var midiMessageTypes = {
  noteOff: 128,
  noteOn: 144,
  polyPressure: 160,
  controllerChange: 176,
  programChange: 192,
  channelPressure: 208,
  pitchWheel: 224,
  systemExclusive: 240,
  timecode: 241,
  songPosition: 242,
  songSelect: 243,
  tuneRequest: 246,
  clock: 248,
  start: 250,
  continue: 251,
  stop: 252,
  activeSensing: 254,
  reset: 255,
  sequenceNumber: 0,
  text: 1,
  copyright: 2,
  trackName: 3,
  instrumentName: 4,
  lyric: 5,
  marker: 6,
  cuePoint: 7,
  programName: 8,
  midiChannelPrefix: 32,
  midiPort: 33,
  endOfTrack: 47,
  setTempo: 81,
  smpteOffset: 84,
  timeSignature: 88,
  keySignature: 89,
  sequenceSpecific: 127
};
var midiControllers = {
  bankSelect: 0,
  modulationWheel: 1,
  breathController: 2,
  undefinedCC3: 3,
  footController: 4,
  portamentoTime: 5,
  dataEntryMSB: 6,
  mainVolume: 7,
  balance: 8,
  undefinedCC9: 9,
  pan: 10,
  expressionController: 11,
  effectControl1: 12,
  effectControl2: 13,
  undefinedCC14: 14,
  undefinedCC15: 15,
  generalPurposeController1: 16,
  generalPurposeController2: 17,
  generalPurposeController3: 18,
  generalPurposeController4: 19,
  undefinedCC20: 20,
  undefinedCC21: 21,
  undefinedCC22: 22,
  undefinedCC23: 23,
  undefinedCC24: 24,
  undefinedCC25: 25,
  undefinedCC26: 26,
  undefinedCC27: 27,
  undefinedCC28: 28,
  undefinedCC29: 29,
  undefinedCC30: 30,
  undefinedCC31: 31,
  bankSelectLSB: 32,
  modulationWheelLSB: 33,
  breathControllerLSB: 34,
  undefinedCC3LSB: 35,
  footControllerLSB: 36,
  portamentoTimeLSB: 37,
  dataEntryLSB: 38,
  mainVolumeLSB: 39,
  balanceLSB: 40,
  undefinedCC9LSB: 41,
  panLSB: 42,
  expressionControllerLSB: 43,
  effectControl1LSB: 44,
  effectControl2LSB: 45,
  undefinedCC14LSB: 46,
  undefinedCC15LSB: 47,
  undefinedCC16LSB: 48,
  undefinedCC17LSB: 49,
  undefinedCC18LSB: 50,
  undefinedCC19LSB: 51,
  undefinedCC20LSB: 52,
  undefinedCC21LSB: 53,
  undefinedCC22LSB: 54,
  undefinedCC23LSB: 55,
  undefinedCC24LSB: 56,
  undefinedCC25LSB: 57,
  undefinedCC26LSB: 58,
  undefinedCC27LSB: 59,
  undefinedCC28LSB: 60,
  undefinedCC29LSB: 61,
  undefinedCC30LSB: 62,
  undefinedCC31LSB: 63,
  sustainPedal: 64,
  portamentoOnOff: 65,
  sostenutoPedal: 66,
  softPedal: 67,
  legatoFootswitch: 68,
  hold2Pedal: 69,
  soundVariation: 70,
  filterResonance: 71,
  releaseTime: 72,
  attackTime: 73,
  brightness: 74,
  decayTime: 75,
  vibratoRate: 76,
  vibratoDepth: 77,
  vibratoDelay: 78,
  soundController10: 79,
  generalPurposeController5: 80,
  generalPurposeController6: 81,
  generalPurposeController7: 82,
  generalPurposeController8: 83,
  portamentoControl: 84,
  undefinedCC85: 85,
  undefinedCC86: 86,
  undefinedCC87: 87,
  undefinedCC88: 88,
  undefinedCC89: 89,
  undefinedCC90: 90,
  reverbDepth: 91,
  tremoloDepth: 92,
  chorusDepth: 93,
  variationDepth: 94,
  phaserDepth: 95,
  dataIncrement: 96,
  dataDecrement: 97,
  nonRegisteredParameterLSB: 98,
  nonRegisteredParameterMSB: 99,
  registeredParameterLSB: 100,
  registeredParameterMSB: 101,
  undefinedCC102LSB: 102,
  undefinedCC103LSB: 103,
  undefinedCC104LSB: 104,
  undefinedCC105LSB: 105,
  undefinedCC106LSB: 106,
  undefinedCC107LSB: 107,
  undefinedCC108LSB: 108,
  undefinedCC109LSB: 109,
  undefinedCC110LSB: 110,
  undefinedCC111LSB: 111,
  undefinedCC112LSB: 112,
  undefinedCC113LSB: 113,
  undefinedCC114LSB: 114,
  undefinedCC115LSB: 115,
  undefinedCC116LSB: 116,
  undefinedCC117LSB: 117,
  undefinedCC118LSB: 118,
  undefinedCC119LSB: 119,
  allSoundOff: 120,
  resetAllControllers: 121,
  localControlOnOff: 122,
  allNotesOff: 123,
  omniModeOff: 124,
  omniModeOn: 125,
  monoModeOn: 126,
  polyModeOn: 127
};
var MIDIMessage = class {
  /**
  * Absolute number of MIDI ticks from the start of the track.
  */
  ticks;
  /**
  * The MIDI message status byte. Note that for meta events, it is the second byte. (not 0xFF)
  */
  statusByte;
  /**
  * Message's binary data
  */
  data;
  /**
  * Creates a new MIDI message
  * @param ticks time of this message in absolute MIDI ticks
  * @param byte the message status byte
  * @param data the message's binary data
  */
  constructor(ticks, byte, data) {
    this.ticks = ticks;
    this.statusByte = byte;
    this.data = data;
  }
};
function getChannel(statusByte) {
  const eventType = statusByte & 240;
  const channel = statusByte & 15;
  let resultChannel = channel;
  switch (eventType) {
    case 128:
    case 144:
    case 160:
    case 176:
    case 192:
    case 208:
    case 224:
      break;
    case 240:
      switch (channel) {
        case 0:
          resultChannel = -3;
          break;
        case 1:
        case 2:
        case 3:
        case 4:
        case 5:
        case 6:
        case 7:
        case 8:
        case 9:
        case 10:
        case 11:
        case 12:
        case 13:
        case 14:
          resultChannel = -1;
          break;
        case 15:
          resultChannel = -2;
          break;
      }
      break;
    default:
      resultChannel = -1;
  }
  return resultChannel;
}
var dataBytesAmount = {
  8: 2,
  9: 2,
  10: 2,
  11: 2,
  12: 1,
  13: 1,
  14: 2
};
var writeText = (text, arr) => {
  for (let i = 0; i < text.length; i++) arr.push(text.charCodeAt(i));
};
function writeMIDIInternal(midi) {
  if (!midi.tracks) throw new Error("MIDI has no tracks!");
  const binaryTrackData = [];
  for (const track of midi.tracks) {
    const binaryTrack = [];
    let currentTick = 0;
    let runningByte = void 0;
    for (const event of track.events) {
      const deltaTicks = Math.max(0, event.ticks - currentTick);
      if (event.statusByte === midiMessageTypes.endOfTrack) {
        currentTick += deltaTicks;
        continue;
      }
      let messageData;
      if (event.statusByte <= midiMessageTypes.sequenceSpecific) {
        messageData = [
          255,
          event.statusByte,
          ...writeVariableLengthQuantity(event.data.length),
          ...event.data
        ];
        runningByte = void 0;
      } else if (event.statusByte === midiMessageTypes.systemExclusive) {
        messageData = [
          240,
          ...writeVariableLengthQuantity(event.data.length),
          ...event.data
        ];
        runningByte = void 0;
      } else {
        messageData = [];
        if (runningByte !== event.statusByte) {
          runningByte = event.statusByte;
          messageData.push(event.statusByte);
        }
        messageData.push(...event.data);
      }
      binaryTrack.push(...writeVariableLengthQuantity(deltaTicks), ...messageData);
      currentTick += deltaTicks;
    }
    binaryTrack.push(0, 255, midiMessageTypes.endOfTrack, 0);
    binaryTrackData.push(new Uint8Array(binaryTrack));
  }
  const binaryData = [];
  writeText("MThd", binaryData);
  binaryData.push(...writeBigEndian(6, 4), 0, midi.format, ...writeBigEndian(midi.tracks.length, 2), ...writeBigEndian(midi.timeDivision, 2));
  for (const track of binaryTrackData) {
    writeText("MTrk", binaryData);
    binaryData.push(...writeBigEndian(track.length, 4), ...track);
  }
  return new Uint8Array(binaryData).buffer;
}
var DEFAULT_PERCUSSION = 9;
var ALL_CHANNELS_OR_DIFFERENT_ACTION = -1;
var EMBEDDED_SOUND_BANK_ID = `SPESSASYNTH_EMBEDDED_BANK_${Math.random()}_DO_NOT_DELETE`;
var EFX_SENDS_GAIN_CORRECTION = 1 / Math.cos(Math.PI / 4) ** 2;
var GM2_DEFAULT_BANK = 121;
var BankSelectHacks = class {
  /**
  * GM2 has a different default bank number
  */
  static getDefaultBank(sys) {
    return sys === "gm2" ? GM2_DEFAULT_BANK : 0;
  }
  static getDrumBank(sys) {
    switch (sys) {
      default:
        throw new Error(`${sys} doesn't have a bank MSB for drums.`);
      case "gm2":
        return 120;
      case "xg":
        return 127;
    }
  }
  /**
  * Checks if this bank number is XG drums.
  */
  static isXGDrums(bankMSB) {
    return bankMSB === 120 || bankMSB === 127;
  }
  /**
  * Checks if this MSB is a valid XG MSB
  */
  static isValidXGMSB(bankMSB) {
    return this.isXGDrums(bankMSB) || bankMSB === 64 || bankMSB === GM2_DEFAULT_BANK;
  }
  static isSystemXG(system) {
    return system === "gm2" || system === "xg";
  }
  static addBankOffset(bankMSB, bankOffset, xgDrums = true) {
    if (this.isXGDrums(bankMSB) && xgDrums) return bankMSB;
    return Math.min(bankMSB + bankOffset, 127);
  }
  static subtractBankOffset(bankMSB, bankOffset, xgDrums = true) {
    if (this.isXGDrums(bankMSB) && xgDrums) return bankMSB;
    return Math.max(0, bankMSB - bankOffset);
  }
};
function isXGOn(e) {
  return e.data[0] === 67 && e.data[2] === 76 && e.data[5] === 126 && e.data[6] === 0;
}
function isGSDrumsOn(e) {
  return e.data[0] === 65 && e.data[2] === 66 && e.data[3] === 18 && e.data[4] === 64 && (e.data[5] & 16) !== 0 && e.data[6] === 21;
}
function isGSOn(e) {
  return e.data[0] === 65 && e.data[2] === 66 && e.data[5] === 0 && e.data[6] === 127;
}
function isGMOn(e) {
  return e.data[0] === 126 && e.data[2] === 9 && e.data[3] === 1;
}
function isGM2On(e) {
  return e.data[0] === 126 && e.data[2] === 9 && e.data[3] === 3;
}
function isDrumEdit(syx) {
  return syx[0] === 65 && syx[2] === 66 && syx[3] === 18 && syx[4] === 65 || syx[0] === 67 && syx[2] === 76 && syx[3] >> 4 === 3;
}
function isProgramChange(syx) {
  if (syx[0] === 67 && syx[2] === 76 && syx[3] === 8 && (syx[5] === 3 || syx[5] === 1 || syx[5] === 2)) return syx[4];
  else if (syx[0] === 65 && syx[2] === 66 && syx[3] === 18 && syx[4] === 64 && (syx[5] & 240) === 16 && syx[6] === 0) return syxToChannel(syx[5] & 15);
  else return -1;
}
function isGSReverb(syx) {
  return syx[0] === 65 && syx[2] === 66 && syx[3] === 18 && syx[4] === 64 && syx[5] === 1 && syx[6] >= 48 && syx[6] <= 55;
}
function isGSChorus(syx) {
  return syx[0] === 65 && syx[2] === 66 && syx[3] === 18 && syx[4] === 64 && syx[5] === 1 && syx[6] >= 56 && syx[6] <= 64;
}
function isGSDelay(syx) {
  return syx[0] === 65 && syx[2] === 66 && syx[3] === 18 && syx[4] === 64 && syx[5] === 1 && syx[6] >= 80 && syx[6] <= 90;
}
function isGSInsertion(syx) {
  return syx[0] === 65 && syx[2] === 66 && syx[3] === 18 && syx[4] === 64 && (syx[5] === 3 || syx[5] >> 4 === 4 && syx[6] === 34);
}
function syxToChannel(part) {
  return [
    9,
    0,
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    10,
    11,
    12,
    13,
    14,
    15
  ][part % 16];
}
function channelToSyx(channel) {
  return [
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    0,
    10,
    11,
    12,
    13,
    14,
    15
  ][channel % 16];
}
function getGsOn(ticks) {
  return new MIDIMessage(ticks, midiMessageTypes.systemExclusive, new IndexedByteArray([
    65,
    16,
    66,
    18,
    64,
    0,
    127,
    0,
    65,
    247
  ]));
}
var MIDIPatchTools = class MIDIPatchTools2 {
  /**
  * Converts a MIDI patch to a string.
  */
  static toMIDIString(patch) {
    if (patch.isGMGSDrum) return `DRUM:${patch.program}`;
    return `${patch.bankLSB}:${patch.bankMSB}:${patch.program}`;
  }
  /**
  * Gets a MIDI patch from a string.
  * @param string
  */
  static fromMIDIString(string) {
    const parts = string.split(":");
    if (parts.length > 3 || parts.length < 2) throw new Error("Invalid MIDI string:");
    return string.startsWith("DRUM") ? {
      bankMSB: 0,
      bankLSB: 0,
      program: Number.parseInt(parts[1]),
      isGMGSDrum: true
    } : {
      bankLSB: Number.parseInt(parts[0]),
      bankMSB: Number.parseInt(parts[1]),
      program: Number.parseInt(parts[2]),
      isGMGSDrum: false
    };
  }
  /**
  * Converts a named MIDI patch to string.
  * @param patch
  */
  static toNamedMIDIString(patch) {
    return `${MIDIPatchTools2.toMIDIString(patch)} ${patch.name}`;
  }
  /**
  * Checks if two MIDI patches match.
  * @param patch1
  * @param patch2
  */
  static matches(patch1, patch2) {
    if (patch1.isGMGSDrum || patch2.isGMGSDrum) return patch1.isGMGSDrum === patch2.isGMGSDrum && patch1.program === patch2.program;
    return patch1.program === patch2.program && patch1.bankLSB === patch2.bankLSB && patch1.bankMSB === patch2.bankMSB;
  }
  /**
  * Gets a named MIDI patch from a string.
  * @param string
  */
  static fromNamedMIDIString(string) {
    const firstSpace = string.indexOf(" ");
    if (firstSpace === -1) throw new Error(`Invalid named MIDI string: ${string}`);
    const patch = this.fromMIDIString(string.slice(0, Math.max(0, firstSpace)));
    const name = string.slice(Math.max(0, firstSpace + 1));
    return {
      ...patch,
      name
    };
  }
  static sorter(a, b) {
    if (a.program !== b.program) return a.program - b.program;
    if (a.isGMGSDrum && !b.isGMGSDrum) return 1;
    if (!a.isGMGSDrum && b.isGMGSDrum) return -1;
    if (a.bankMSB !== b.bankMSB) return a.bankMSB - b.bankMSB;
    return a.bankLSB - b.bankLSB;
  }
};
var DEFAULT_COPYRIGHT = "Created using SpessaSynth";
function correctBankOffsetInternal(mid, bankOffset, soundBank) {
  let system = "gm";
  const unwantedSystems = [];
  const ports = new Array(mid.tracks.length).fill(0);
  const channelsAmount = 16 + Math.max(...mid.portChannelOffsetMap);
  const channelsInfo = [];
  for (let i = 0; i < channelsAmount; i++) channelsInfo.push({
    program: 0,
    drums: i % 16 === 9,
    lastBank: void 0,
    lastBankLSB: void 0,
    hasBankSelect: false
  });
  mid.iterate((e, trackNum) => {
    const portOffset = mid.portChannelOffsetMap[ports[trackNum]];
    if (e.statusByte === midiMessageTypes.midiPort) {
      ports[trackNum] = e.data[0];
      return;
    }
    const status = e.statusByte & 240;
    if (status !== midiMessageTypes.controllerChange && status !== midiMessageTypes.programChange && status !== midiMessageTypes.systemExclusive) return;
    if (status === midiMessageTypes.systemExclusive) {
      if (!isGSDrumsOn(e)) {
        if (isXGOn(e)) system = "xg";
        else if (isGSOn(e)) system = "gs";
        else if (isGMOn(e)) {
          system = "gm";
          unwantedSystems.push({
            tNum: trackNum,
            e
          });
        } else if (isGM2On(e)) system = "gm2";
        return;
      }
      const sysexChannel = syxToChannel(e.data[5] & 15) + portOffset;
      channelsInfo[sysexChannel].drums = !!(e.data[7] > 0 && e.data[5] >> 4);
      return;
    }
    const chNum = (e.statusByte & 15) + portOffset;
    const channel = channelsInfo[chNum];
    if (status === midiMessageTypes.programChange) {
      const patch = {
        program: e.data[0],
        bankLSB: channel.lastBankLSB?.data?.[1] ?? 0,
        bankMSB: BankSelectHacks.subtractBankOffset(channel.lastBank?.data?.[1] ?? 0, mid.bankOffset),
        isGMGSDrum: channel.drums
      };
      const targetPreset = soundBank.getPreset(patch, system);
      SpessaSynthInfo(`%cInput patch: %c${MIDIPatchTools.toMIDIString(patch)}%c. Channel %c${chNum}%c. Changing patch to ${targetPreset.toString()}.`, consoleColors.info, consoleColors.unrecognized, consoleColors.info, consoleColors.recognized, consoleColors.info);
      e.data[0] = targetPreset.program;
      if (targetPreset.isGMGSDrum && BankSelectHacks.isSystemXG(system)) return;
      if (channel.lastBank === void 0) return;
      channel.lastBank.data[1] = BankSelectHacks.addBankOffset(targetPreset.bankMSB, bankOffset, targetPreset.isXGDrums);
      if (channel.lastBankLSB === void 0) return;
      channel.lastBankLSB.data[1] = targetPreset.bankLSB;
      return;
    }
    const isLSB = e.data[0] === midiControllers.bankSelectLSB;
    if (e.data[0] !== midiControllers.bankSelect && !isLSB) return;
    channel.hasBankSelect = true;
    if (isLSB) channel.lastBankLSB = e;
    else channel.lastBank = e;
  });
  for (const [ch, has] of channelsInfo.entries()) {
    if (has.hasBankSelect) continue;
    const midiChannel = ch % 16;
    const status = midiMessageTypes.programChange | midiChannel;
    const portOffset = Math.floor(ch / 16) * 16;
    const port = mid.portChannelOffsetMap.indexOf(portOffset);
    const track = mid.tracks.find((t) => t.port === port && t.channels.has(midiChannel));
    if (track === void 0) continue;
    let indexToAdd = track.events.findIndex((e) => e.statusByte === status);
    if (indexToAdd === -1) {
      const programIndex = track.events.findIndex((e) => e.statusByte > 128 && e.statusByte < 240 && (e.statusByte & 15) === midiChannel);
      if (programIndex === -1) continue;
      const programTicks = track.events[programIndex].ticks;
      const targetProgram = soundBank.getPreset({
        bankMSB: 0,
        bankLSB: 0,
        program: 0,
        isGMGSDrum: false
      }, system).program;
      track.addEvents(programIndex, new MIDIMessage(programTicks, midiMessageTypes.programChange | midiChannel, new IndexedByteArray([targetProgram])));
      indexToAdd = programIndex;
    }
    SpessaSynthInfo(`%cAdding bank select for %c${ch}`, consoleColors.info, consoleColors.recognized);
    const ticks = track.events[indexToAdd].ticks;
    const targetPreset = soundBank.getPreset({
      bankLSB: 0,
      bankMSB: 0,
      program: has.program,
      isGMGSDrum: has.drums
    }, system);
    const targetBank = BankSelectHacks.addBankOffset(targetPreset.bankMSB, bankOffset, targetPreset.isXGDrums);
    track.addEvents(indexToAdd, new MIDIMessage(ticks, midiMessageTypes.controllerChange | midiChannel, new IndexedByteArray([midiControllers.bankSelect, targetBank])));
  }
  if (system === "gm" && !BankSelectHacks.isSystemXG(system)) {
    for (const m of unwantedSystems) {
      const track = mid.tracks[m.tNum];
      track.deleteEvent(track.events.indexOf(m.e));
    }
    let index = 0;
    if (mid.tracks[0].events[0].statusByte === midiMessageTypes.trackName) index++;
    mid.tracks[0].addEvents(index, getGsOn(0));
  }
}
var DEFAULT_RMIDI_WRITE_OPTIONS = {
  bankOffset: 0,
  metadata: {},
  correctBankOffset: true,
  soundBank: void 0
};
function writeRMIDIInternal(mid, soundBankBinary, options) {
  const metadata = options.metadata;
  SpessaSynthGroup("%cWriting the RMIDI File...", consoleColors.info);
  SpessaSynthInfo("metadata", metadata);
  SpessaSynthInfo("Initial bank offset", mid.bankOffset);
  if (options.correctBankOffset) {
    if (!options.soundBank) throw new Error("Sound bank must be provided if correcting bank offset.");
    correctBankOffsetInternal(mid, options.bankOffset, options.soundBank);
  }
  const newMid = new IndexedByteArray(mid.writeMIDI());
  metadata.name ??= mid.getName();
  metadata.creationDate ??= /* @__PURE__ */ new Date();
  metadata.copyright ??= DEFAULT_COPYRIGHT;
  metadata.software ??= "SpessaSynth";
  Object.entries(metadata).forEach((v) => {
    const val = v;
    if (val[1]) mid.setRMIDInfo(val[0], val[1]);
  });
  const infoContent = [];
  const writeInfo = (type, data) => {
    infoContent.push(RIFFChunk.write(type, data));
  };
  for (const v of Object.entries(mid.rmidiInfo)) {
    const type = v[0];
    const data = v[1];
    switch (type) {
      case "album":
        writeInfo("IALB", data);
        writeInfo("IPRD", data);
        break;
      case "software":
        writeInfo("ISFT", data);
        break;
      case "infoEncoding":
        writeInfo("IENC", data);
        break;
      case "creationDate":
        writeInfo("ICRD", data);
        break;
      case "picture":
        writeInfo("IPIC", data);
        break;
      case "name":
        writeInfo("INAM", data);
        break;
      case "artist":
        writeInfo("IART", data);
        break;
      case "genre":
        writeInfo("IGNR", data);
        break;
      case "copyright":
        writeInfo("ICOP", data);
        break;
      case "comment":
        writeInfo("ICMT", data);
        break;
      case "engineer":
        writeInfo("IENG", data);
        break;
      case "subject":
        writeInfo("ISBJ", data);
        break;
      case "midiEncoding":
        writeInfo("MENC", data);
        break;
    }
  }
  const DBNK = new IndexedByteArray(2);
  writeLittleEndianIndexed(DBNK, options.bankOffset, 2);
  infoContent.push(RIFFChunk.write("DBNK", DBNK));
  SpessaSynthInfo("%cFinished!", consoleColors.info);
  SpessaSynthGroupEnd();
  return RIFFChunk.writeParts("RIFF", [
    getStringBytes("RMID"),
    RIFFChunk.write("data", newMid),
    RIFFChunk.writeParts("INFO", infoContent, true),
    new IndexedByteArray(soundBankBinary)
  ]).buffer;
}
function getUsedProgramsAndKeys(mid, soundBank) {
  SpessaSynthGroupCollapsed("%cSearching for all used programs and keys...", consoleColors.info);
  const channelsAmount = 16 + Math.max(...mid.portChannelOffsetMap);
  const channelPresets = [];
  let system = "gs";
  for (let i = 0; i < channelsAmount; i++) {
    const isDrum = i % 16 === 9;
    channelPresets.push({
      preset: soundBank.getPreset({
        bankLSB: 0,
        bankMSB: 0,
        isGMGSDrum: isDrum,
        program: 0
      }, system),
      bankMSB: 0,
      bankLSB: 0,
      isDrum
    });
  }
  const usedProgramsAndKeys = /* @__PURE__ */ new Map();
  const ports = mid.tracks.map((t) => t.port);
  mid.iterate((event, trackNum) => {
    if (event.statusByte === midiMessageTypes.midiPort && mid.tracks[trackNum].channels.size > 0) {
      let port = event.data[0];
      if (mid.portChannelOffsetMap[port] === void 0) {
        SpessaSynthWarn(`Invalid port ${port} on track ${trackNum}. (No offset found in the MIDI map.`);
        port = 0;
      }
      ports[trackNum] = port;
      return;
    }
    const status = event.statusByte & 240;
    if (status !== midiMessageTypes.noteOn && status !== midiMessageTypes.controllerChange && status !== midiMessageTypes.programChange && status !== midiMessageTypes.systemExclusive) return;
    let ch = channelPresets[(event.statusByte & 15) + mid.portChannelOffsetMap[ports[trackNum]] || 0];
    switch (status) {
      case midiMessageTypes.programChange:
        ch.preset = soundBank.getPreset({
          bankMSB: ch.bankMSB,
          bankLSB: ch.bankLSB,
          program: event.data[0],
          isGMGSDrum: ch.isDrum
        }, system);
        break;
      case midiMessageTypes.controllerChange:
        switch (event.data[0]) {
          default:
            return;
          case midiControllers.bankSelectLSB:
            ch.bankLSB = event.data[1];
            break;
          case midiControllers.bankSelect:
            ch.bankMSB = event.data[1];
        }
        break;
      case midiMessageTypes.noteOn: {
        if (event.data[1] === 0) return;
        if (!ch.preset) return;
        let combos = usedProgramsAndKeys.get(ch.preset);
        if (!combos) {
          combos = /* @__PURE__ */ new Set();
          usedProgramsAndKeys.set(ch.preset, combos);
        }
        combos.add(`${event.data[0]}-${event.data[1]}`);
        break;
      }
      case midiMessageTypes.systemExclusive:
        {
          if (!isGSDrumsOn(event)) {
            if (isXGOn(event)) {
              system = "xg";
              SpessaSynthInfo("%cXG on detected!", consoleColors.recognized);
            } else if (isGM2On(event)) {
              system = "gm2";
              SpessaSynthInfo("%cGM2 on detected!", consoleColors.recognized);
            } else if (isGMOn(event)) {
              system = "gm";
              SpessaSynthInfo("%cGM on detected!", consoleColors.recognized);
            } else if (isGSOn(event)) {
              system = "gs";
              SpessaSynthInfo("%cGS on detected!", consoleColors.recognized);
            }
            return;
          }
          const sysexChannel = syxToChannel(event.data[5] & 15) + mid.portChannelOffsetMap[ports[trackNum]];
          const isDrum = !!(event.data[7] > 0 && event.data[5] >> 4);
          ch = channelPresets[sysexChannel];
          ch.isDrum = isDrum;
        }
        break;
    }
  });
  for (const [preset, combos] of usedProgramsAndKeys.entries()) if (combos.size === 0) {
    SpessaSynthInfo(`%cDetected change but no keys for %c${preset.name}`, consoleColors.info, consoleColors.value);
    usedProgramsAndKeys.delete(preset);
  }
  SpessaSynthGroupEnd();
  return usedProgramsAndKeys;
}
var getTempo = (event) => {
  event.data = new IndexedByteArray(event.data.buffer);
  return 6e7 / readBigEndian(event.data, 3);
};
function getNoteTimesInternal(midi, minDrumLength = 0) {
  const noteTimes = [];
  const events = midi.tracks.map((t) => t.events).flat();
  events.sort((e1, e2) => e1.ticks - e2.ticks);
  for (let i = 0; i < 16; i++) noteTimes.push([]);
  let elapsedTime = 0;
  let oneTickToSeconds = 60 / (120 * midi.timeDivision);
  let eventIndex = 0;
  let unfinished = 0;
  const unfinishedNotes = [];
  for (let i = 0; i < 16; i++) unfinishedNotes.push([]);
  const noteOff = (midiNote, channel) => {
    const noteIndex = unfinishedNotes[channel].findIndex((n) => n.midiNote === midiNote);
    const note = unfinishedNotes[channel][noteIndex];
    if (note) {
      const time = elapsedTime - note.start;
      note.length = time;
      if (channel === 9) note.length = Math.max(time, minDrumLength);
      unfinishedNotes[channel].splice(noteIndex, 1);
    }
    unfinished--;
  };
  while (eventIndex < events.length) {
    const event = events[eventIndex];
    const status = event.statusByte >> 4;
    const channel = event.statusByte & 15;
    if (status === 8) noteOff(event.data[0], channel);
    else if (status === 9) if (event.data[1] === 0) noteOff(event.data[0], channel);
    else {
      noteOff(event.data[0], channel);
      const noteTime = {
        midiNote: event.data[0],
        start: elapsedTime,
        length: -1,
        velocity: event.data[1] / 127
      };
      noteTimes[channel].push(noteTime);
      unfinishedNotes[channel].push(noteTime);
      unfinished++;
    }
    else if (event.statusByte === 81) oneTickToSeconds = 60 / (getTempo(event) * midi.timeDivision);
    if (++eventIndex >= events.length) break;
    elapsedTime += oneTickToSeconds * (events[eventIndex].ticks - event.ticks);
  }
  if (unfinished > 0) for (const [channel, channelNotes] of unfinishedNotes.entries()) for (const note of channelNotes) {
    const time = elapsedTime - note.start;
    note.length = time;
    if (channel === 9) note.length = Math.max(time, minDrumLength);
  }
  return noteTimes;
}
var interpolationTypes = {
  linear: 0,
  nearestNeighbor: 1,
  hermite: 2
};
var customControllers = {
  /**
  * Cents, RPN for fine-tuning
  */
  channelTuning: 0,
  /**
  * Cents, only the decimal tuning, (e.g., transpose is 4.5,
  * Then shift by 4 keys + tune by 50 cents)
  */
  channelTransposeFine: 1,
  /**
  * The MIDI specification assumes the default modulation depth is 50 cents,
  * but it may vary for different sound banks.
  * For example, if you want a modulation depth of 100 cents,
  * the multiplier will be 2,
  * which, for a preset with a depth of 50,
  * will create a total modulation depth of 100 cents.
  */
  modulationMultiplier: 2,
  /**
  * Cents, set by system exclusive
  */
  masterTuning: 3,
  /**
  * Semitones, for RPN coarse tuning
  */
  channelTuningSemitones: 4,
  /**
  * Key shift: for system exclusive
  */
  channelKeyShift: 5,
  /**
  * Sf2 NPRN LSB for selecting a generator value
  */
  sf2NPRNGeneratorLSB: 6
};
var reverbAddressMap = {
  character: 49,
  preLowpass: 50,
  level: 51,
  time: 52,
  delayFeedback: 53,
  preDelayTime: 55
};
var chorusAddressMap = {
  preLowpass: 57,
  level: 58,
  feedback: 59,
  delay: 60,
  rate: 61,
  depth: 62,
  sendLevelToReverb: 63,
  sendLevelToDelay: 64
};
var delayAddressMap = {
  preLowpass: 81,
  timeCenter: 82,
  timeRatioLeft: 83,
  timeRatioRight: 84,
  levelCenter: 85,
  levelLeft: 86,
  levelRight: 87,
  level: 88,
  feedback: 89,
  sendLevelToReverb: 90
};
function getControllerChange(channel, cc, value, ticks) {
  return new MIDIMessage(ticks, midiMessageTypes.controllerChange | channel % 16, new IndexedByteArray([cc, value]));
}
function sendAddress$1(ticks, a1, a2, a3, data) {
  const checksum = 128 - (a1 + a2 + a3 + data.reduce((sum, cur) => sum + cur, 0)) % 128 & 127;
  return new MIDIMessage(ticks, midiMessageTypes.systemExclusive, new Uint8Array([
    65,
    16,
    66,
    18,
    a1,
    a2,
    a3,
    ...data,
    checksum,
    247
  ]));
}
function getDrumChange(channel, ticks) {
  return sendAddress$1(ticks, 40, 16 | channelToSyx(channel), 21, [1]);
}
function modifyMIDIInternal(midi, { programChanges = [], controllerChanges = [], channelsToClear = [], channelsToTranspose = [], clearDrumParams = false, reverbParams, chorusParams, delayParams, insertionParams }) {
  SpessaSynthGroupCollapsed("%cApplying changes to the MIDI file...", consoleColors.info);
  SpessaSynthInfo("Desired program changes:", programChanges);
  SpessaSynthInfo("Desired CC changes:", controllerChanges);
  SpessaSynthInfo("Desired channels to clear:", channelsToClear);
  SpessaSynthInfo("Desired channels to transpose:", channelsToTranspose);
  SpessaSynthInfo("Desired reverb parameters", reverbParams);
  SpessaSynthInfo("Desired chorus parameters", chorusParams);
  SpessaSynthInfo("Desired delay parameters", delayParams);
  SpessaSynthInfo("Desired insertion parameters", insertionParams);
  const channelsToChangeProgram = /* @__PURE__ */ new Set();
  for (const c of programChanges) channelsToChangeProgram.add(c.channel);
  let system = "gs";
  let addedGs = false;
  const midiPorts = midi.tracks.map((t) => t.port);
  const midiPortChannelOffsets = {};
  let midiPortChannelOffset = 0;
  const assignMIDIPort = (trackNum, port) => {
    if (midi.tracks[trackNum].channels.size === 0) return;
    if (midiPortChannelOffset === 0) {
      midiPortChannelOffset += 16;
      midiPortChannelOffsets[port] = 0;
    }
    if (midiPortChannelOffsets[port] === void 0) {
      midiPortChannelOffsets[port] = midiPortChannelOffset;
      midiPortChannelOffset += 16;
    }
    midiPorts[trackNum] = port;
  };
  for (const [i, track] of midi.tracks.entries()) assignMIDIPort(i, track.port);
  const channelsAmount = midiPortChannelOffset;
  const isFirstNoteOn = new Array(channelsAmount).fill(true);
  const coarseTranspose = new Array(channelsAmount).fill(0);
  const fineTranspose = new Array(channelsAmount).fill(0);
  for (const transpose of channelsToTranspose) {
    const coarse = Math.trunc(transpose.keyShift);
    const fine = transpose.keyShift - coarse;
    coarseTranspose[transpose.channel] = coarse;
    fineTranspose[transpose.channel] = fine;
  }
  let lastNrpnMsb = -1;
  let lastNrpnMsbTrack = 0;
  let lastNrpnLsb = -1;
  let lastNrpnLsbTrack = 0;
  let isNrpnMode = false;
  midi.iterate((e, trackNum, eventIndexes) => {
    const track = midi.tracks[trackNum];
    const index = eventIndexes[trackNum];
    const deleteThisEvent = () => {
      track.deleteEvent(index);
      eventIndexes[trackNum]--;
    };
    const addEventBefore = (e2, offset = 0) => {
      track.addEvents(index + offset, e2);
      eventIndexes[trackNum]++;
    };
    const portOffset = midiPortChannelOffsets[midiPorts[trackNum]] || 0;
    if (e.statusByte === midiMessageTypes.midiPort) {
      assignMIDIPort(trackNum, e.data[0]);
      return;
    }
    if (e.statusByte <= midiMessageTypes.sequenceSpecific && e.statusByte >= midiMessageTypes.sequenceNumber) return;
    const status = e.statusByte & 240;
    const midiChannel = e.statusByte & 15;
    const channel = midiChannel + portOffset;
    if (e.statusByte !== midiMessageTypes.systemExclusive && channelsToClear.includes(channel)) {
      deleteThisEvent();
      return;
    }
    switch (status) {
      case midiMessageTypes.noteOn:
        if (isFirstNoteOn[channel]) {
          isFirstNoteOn[channel] = false;
          for (const change of controllerChanges.filter((c) => c.channel === channel)) addEventBefore(getControllerChange(midiChannel, change.controllerNumber, change.controllerValue, e.ticks));
          const fineTune = fineTranspose[channel];
          if (fineTune !== 0) {
            const centsCoarse = fineTune * 64 + 64;
            const rpnCoarse = getControllerChange(midiChannel, midiControllers.registeredParameterMSB, 0, e.ticks);
            const rpnFine = getControllerChange(midiChannel, midiControllers.registeredParameterLSB, 1, e.ticks);
            const dataEntryCoarse = getControllerChange(channel, midiControllers.dataEntryMSB, centsCoarse, e.ticks);
            addEventBefore(getControllerChange(midiChannel, midiControllers.dataEntryLSB, 0, e.ticks));
            addEventBefore(dataEntryCoarse);
            addEventBefore(rpnFine);
            addEventBefore(rpnCoarse);
          }
          if (channelsToChangeProgram.has(channel)) {
            const change = programChanges.find((c) => c.channel === channel);
            if (!change) return;
            SpessaSynthInfo(`%cSetting %c${change.channel}%c to %c${MIDIPatchTools.toMIDIString(change)}%c. Track num: %c${trackNum}`, consoleColors.info, consoleColors.recognized, consoleColors.info, consoleColors.recognized, consoleColors.info, consoleColors.recognized);
            let desiredBankMSB = change.bankMSB;
            let desiredBankLSB = change.bankLSB;
            const desiredProgram = change.program;
            addEventBefore(new MIDIMessage(e.ticks, midiMessageTypes.programChange | midiChannel, new IndexedByteArray([desiredProgram])));
            const addBank = (isLSB, v) => {
              addEventBefore(getControllerChange(midiChannel, isLSB ? midiControllers.bankSelectLSB : midiControllers.bankSelect, v, e.ticks));
            };
            if (BankSelectHacks.isSystemXG(system) && change.isGMGSDrum) {
              SpessaSynthInfo(`%cAdding XG Drum change on track %c${trackNum}`, consoleColors.recognized, consoleColors.value);
              desiredBankMSB = BankSelectHacks.getDrumBank(system);
              desiredBankLSB = 0;
            }
            addBank(false, desiredBankMSB);
            addBank(true, desiredBankLSB);
            if (change.isGMGSDrum && !BankSelectHacks.isSystemXG(system) && midiChannel !== 9) {
              SpessaSynthInfo(`%cAdding GS Drum change on track %c${trackNum}`, consoleColors.recognized, consoleColors.value);
              addEventBefore(getDrumChange(midiChannel, e.ticks));
            }
          }
        }
        e.data[0] += coarseTranspose[channel];
        break;
      case midiMessageTypes.noteOff:
        e.data[0] += coarseTranspose[channel];
        break;
      case midiMessageTypes.programChange:
        if (channelsToChangeProgram.has(channel)) {
          deleteThisEvent();
          return;
        }
        break;
      case midiMessageTypes.controllerChange: {
        const ccNum = e.data[0];
        if (controllerChanges.find((c) => c.channel === channel && ccNum === c.controllerNumber) !== void 0) {
          deleteThisEvent();
          return;
        }
        switch (ccNum) {
          case midiControllers.bankSelect:
          case midiControllers.bankSelectLSB:
            if (channelsToChangeProgram.has(channel)) deleteThisEvent();
            return;
          case midiControllers.registeredParameterLSB:
          case midiControllers.registeredParameterMSB:
            isNrpnMode = false;
            return;
          case midiControllers.nonRegisteredParameterMSB:
            lastNrpnMsb = eventIndexes[trackNum];
            lastNrpnMsbTrack = trackNum;
            isNrpnMode = true;
            return;
          case midiControllers.nonRegisteredParameterLSB:
            lastNrpnLsb = eventIndexes[trackNum];
            lastNrpnLsbTrack = trackNum;
            isNrpnMode = true;
            return;
          case midiControllers.dataEntryMSB:
            if (lastNrpnLsb && lastNrpnMsb && isNrpnMode && clearDrumParams) {
              const msb = midi.tracks[lastNrpnMsbTrack].events[lastNrpnMsb].data[1];
              if (msb >= 24 && msb <= 31) {
                deleteThisEvent();
                const lsbTrack = midi.tracks[lastNrpnLsbTrack];
                const msbTrack = midi.tracks[lastNrpnMsbTrack];
                lsbTrack.deleteEvent(lastNrpnLsb);
                eventIndexes[lastNrpnLsbTrack]--;
                msbTrack.deleteEvent(lastNrpnMsb);
                eventIndexes[lastNrpnMsbTrack]--;
              }
            }
            return;
          default:
            return;
        }
      }
      case midiMessageTypes.systemExclusive: {
        if (isXGOn(e)) {
          SpessaSynthInfo("%cXG system on detected", consoleColors.info);
          system = "xg";
          addedGs = true;
          return;
        }
        if (isGM2On(e)) {
          SpessaSynthInfo("%cGM2 system on detected", consoleColors.info);
          system = "gm2";
          addedGs = true;
          return;
        }
        if (isGSOn(e)) {
          addedGs = true;
          SpessaSynthInfo("%cGS on detected!", consoleColors.recognized);
          return;
        }
        if (isGMOn(e)) {
          SpessaSynthInfo("%cGM on detected, removing!", consoleColors.info);
          deleteThisEvent();
          addedGs = false;
          return;
        }
        if (clearDrumParams && isDrumEdit(e.data)) {
          deleteThisEvent();
          return;
        }
        if (reverbParams && isGSReverb(e.data)) {
          deleteThisEvent();
          return;
        }
        if (chorusParams && isGSChorus(e.data)) {
          deleteThisEvent();
          return;
        }
        if (delayParams && isGSDelay(e.data)) {
          deleteThisEvent();
          return;
        }
        if (insertionParams && isGSInsertion(e.data)) {
          deleteThisEvent();
          return;
        }
        const prog = isProgramChange(e.data);
        if (prog !== -1) {
          if (channelsToChangeProgram.has(prog + portOffset)) deleteThisEvent();
          return;
        }
      }
    }
  });
  const targetTicks = Math.max(0, midi.firstNoteOn - 10);
  const targetTrack = midi.tracks[0];
  const targetIndex = Math.max(0, targetTrack.events.findIndex((m) => m.ticks >= targetTicks) - 1);
  if (reverbParams) {
    const m = reverbAddressMap;
    const p = reverbParams;
    targetTrack.addEvents(targetIndex, sendAddress$1(targetTicks, 64, 1, m.level, [p.level]), sendAddress$1(targetTicks, 64, 1, m.preLowpass, [p.preLowpass]), sendAddress$1(targetTicks, 64, 1, m.character, [p.character]), sendAddress$1(targetTicks, 64, 1, m.time, [p.time]), sendAddress$1(targetTicks, 64, 1, m.delayFeedback, [p.delayFeedback]), sendAddress$1(targetTicks, 64, 1, m.preDelayTime, [p.preDelayTime]));
  }
  if (chorusParams) {
    const m = chorusAddressMap;
    const p = chorusParams;
    targetTrack.addEvents(targetIndex, sendAddress$1(targetTicks, 64, 1, m.level, [p.level]), sendAddress$1(targetTicks, 64, 1, m.preLowpass, [p.preLowpass]), sendAddress$1(targetTicks, 64, 1, m.feedback, [p.feedback]), sendAddress$1(targetTicks, 64, 1, m.delay, [p.delay]), sendAddress$1(targetTicks, 64, 1, m.rate, [p.rate]), sendAddress$1(targetTicks, 64, 1, m.depth, [p.depth]), sendAddress$1(targetTicks, 64, 1, m.sendLevelToReverb, [p.sendLevelToReverb]), sendAddress$1(targetTicks, 64, 1, m.sendLevelToDelay, [p.sendLevelToDelay]));
  }
  if (delayParams) {
    const m = delayAddressMap;
    const p = delayParams;
    targetTrack.addEvents(targetIndex, sendAddress$1(targetTicks, 64, 1, m.level, [p.level]), sendAddress$1(targetTicks, 64, 1, m.preLowpass, [p.preLowpass]), sendAddress$1(targetTicks, 64, 1, m.timeCenter, [p.timeCenter]), sendAddress$1(targetTicks, 64, 1, m.timeRatioLeft, [p.timeRatioLeft]), sendAddress$1(targetTicks, 64, 1, m.timeRatioRight, [p.timeRatioRight]), sendAddress$1(targetTicks, 64, 1, m.levelCenter, [p.levelCenter]), sendAddress$1(targetTicks, 64, 1, m.levelLeft, [p.levelLeft]), sendAddress$1(targetTicks, 64, 1, m.levelRight, [p.levelRight]), sendAddress$1(targetTicks, 64, 1, m.feedback, [p.feedback]), sendAddress$1(targetTicks, 64, 1, m.sendLevelToReverb, [p.sendLevelToReverb]));
  }
  if (insertionParams) {
    const p = insertionParams;
    for (let channel = 0; channel < p.channels.length; channel++) if (p.channels[channel]) targetTrack.addEvents(targetTicks, sendAddress$1(targetTicks, 64, 64 | channelToSyx(channel), 34, [1]));
    for (let param = 0; param < p.params.length; param++) {
      const value = p.params[param];
      if (value === 255) continue;
      targetTrack.addEvents(targetIndex, sendAddress$1(targetTicks, 64, 3, param + 3, [value]));
    }
    targetTrack.addEvents(targetIndex, sendAddress$1(targetTicks, 64, 3, 0, [p.type >> 8, p.type & 127]));
  }
  if (!addedGs && programChanges.length > 0) {
    let index = 0;
    if (midi.tracks[0].events[0].statusByte === midiMessageTypes.trackName) index++;
    midi.tracks[0].addEvents(index, getGsOn(0));
    SpessaSynthInfo("%cGS on not detected. Adding it.", consoleColors.info);
  }
  midi.flush();
  SpessaSynthGroupEnd();
}
function applySnapshotInternal(midi, snapshot) {
  const channelsToTranspose = [];
  const channelsToClear = [];
  const programChanges = [];
  const controllerChanges = [];
  for (const [channelNumber, channel] of snapshot.channelSnapshots.entries()) {
    if (channel.isMuted) {
      channelsToClear.push(channelNumber);
      continue;
    }
    const transposeFloat = channel.keyShift + channel.customControllers[customControllers.channelTransposeFine] / 100;
    if (transposeFloat !== 0) channelsToTranspose.push({
      channel: channelNumber,
      keyShift: transposeFloat
    });
    if (channel.lockPreset) programChanges.push({
      channel: channelNumber,
      ...channel.patch
    });
    for (const [ccNumber, l] of channel.lockedControllers.entries()) {
      if (!l || ccNumber > 127 || ccNumber === midiControllers.bankSelect) continue;
      const targetValue = channel.midiControllers[ccNumber] >> 7;
      controllerChanges.push({
        channel: channelNumber,
        controllerNumber: ccNumber,
        controllerValue: targetValue
      });
    }
  }
  midi.modify({
    programChanges,
    controllerChanges,
    channelsToClear,
    channelsToTranspose,
    clearDrumParams: snapshot.masterParameters.drumLock,
    reverbParams: snapshot.masterParameters.reverbLock ? snapshot.reverbSnapshot : void 0,
    chorusParams: snapshot.masterParameters.chorusLock ? snapshot.chorusSnapshot : void 0,
    delayParams: snapshot.masterParameters.delayLock ? snapshot.delaySnapshot : void 0,
    insertionParams: snapshot.masterParameters.insertionEffectLock ? snapshot.insertionSnapshot : void 0
  });
}
var metadataTypes = {
  XMFFileType: 0,
  nodeName: 1,
  nodeIDNumber: 2,
  resourceFormat: 3,
  filenameOnDisk: 4,
  filenameExtensionOnDisk: 5,
  macOSFileTypeAndCreator: 6,
  mimeType: 7,
  title: 8,
  copyrightNotice: 9,
  comment: 10,
  autoStart: 11,
  preload: 12,
  contentDescription: 13,
  ID3Metadata: 14
};
var referenceTypeIds = {
  inLineResource: 1,
  inFileResource: 2,
  inFileNode: 3,
  externalFile: 4,
  externalXMF: 5,
  XMFFileURIandNodeID: 6
};
var resourceFormatIDs = {
  StandardMIDIFile: 0,
  StandardMIDIFileType1: 1,
  DLS1: 2,
  DLS2: 3,
  DLS22: 4,
  mobileDLS: 5,
  unknown: -1,
  folder: -2
};
var formatTypeIDs = {
  standard: 0,
  MMA: 1,
  registered: 2,
  nonRegistered: 3
};
var unpackerIDs = {
  none: 0,
  MMAUnpacker: 1,
  registered: 2,
  nonRegistered: 3
};
var XMFNode = class XMFNode2 {
  length;
  /**
  * 0 means it's a file node
  */
  itemCount;
  metadataLength;
  metadata = {};
  nodeData;
  innerNodes = [];
  packedContent = false;
  nodeUnpackers = [];
  resourceFormat = "unknown";
  referenceTypeID;
  constructor(binaryData) {
    const nodeStartIndex = binaryData.currentIndex;
    this.length = readVariableLengthQuantity(binaryData);
    this.itemCount = readVariableLengthQuantity(binaryData);
    const headerLength = readVariableLengthQuantity(binaryData);
    const remainingHeader = headerLength - (binaryData.currentIndex - nodeStartIndex);
    const headerData = binaryData.slice(binaryData.currentIndex, binaryData.currentIndex + remainingHeader);
    binaryData.currentIndex += remainingHeader;
    this.metadataLength = readVariableLengthQuantity(headerData);
    const metadataChunk = headerData.slice(headerData.currentIndex, headerData.currentIndex + this.metadataLength);
    headerData.currentIndex += this.metadataLength;
    let fieldSpecifier;
    let key;
    while (metadataChunk.currentIndex < metadataChunk.length) {
      if (metadataChunk[metadataChunk.currentIndex] === 0) {
        metadataChunk.currentIndex++;
        fieldSpecifier = readVariableLengthQuantity(metadataChunk);
        if (Object.values(metadataTypes).includes(fieldSpecifier)) key = Object.keys(metadataTypes).find((k) => metadataTypes[k] === fieldSpecifier) ?? "";
        else {
          SpessaSynthInfo(`Unknown field specifier: ${fieldSpecifier}`);
          key = `unknown_${fieldSpecifier}`;
        }
      } else {
        fieldSpecifier = readBinaryStringIndexed(metadataChunk, readVariableLengthQuantity(metadataChunk));
        key = fieldSpecifier;
      }
      const numberOfVersions = readVariableLengthQuantity(metadataChunk);
      if (numberOfVersions === 0) {
        const dataLength = readVariableLengthQuantity(metadataChunk);
        const contentsChunk = metadataChunk.slice(metadataChunk.currentIndex, metadataChunk.currentIndex + dataLength);
        metadataChunk.currentIndex += dataLength;
        const formatID = readVariableLengthQuantity(contentsChunk);
        this.metadata[key] = formatID < 4 ? readBinaryStringIndexed(contentsChunk, dataLength - 1) : contentsChunk.slice(contentsChunk.currentIndex);
      } else {
        SpessaSynthInfo(`International content: ${numberOfVersions}`);
        metadataChunk.currentIndex += readVariableLengthQuantity(metadataChunk);
      }
    }
    const unpackersStart = headerData.currentIndex;
    const unpackersLength = readVariableLengthQuantity(headerData);
    const unpackersData = headerData.slice(headerData.currentIndex, unpackersStart + unpackersLength);
    headerData.currentIndex = unpackersStart + unpackersLength;
    if (unpackersLength > 0) {
      this.packedContent = true;
      while (unpackersData.currentIndex < unpackersLength) {
        const unpacker = { id: readVariableLengthQuantity(unpackersData) };
        switch (unpacker.id) {
          case unpackerIDs.nonRegistered:
          case unpackerIDs.registered:
            SpessaSynthGroupEnd();
            throw new Error(`Unsupported unpacker ID: ${unpacker.id}`);
          default:
            SpessaSynthGroupEnd();
            throw new Error(`Unknown unpacker ID: ${unpacker.id}`);
          case unpackerIDs.none:
            unpacker.standardID = readVariableLengthQuantity(unpackersData);
            break;
          case unpackerIDs.MMAUnpacker:
            {
              let manufacturerID = unpackersData[unpackersData.currentIndex++];
              if (manufacturerID === 0) {
                manufacturerID <<= 8;
                manufacturerID |= unpackersData[unpackersData.currentIndex++];
                manufacturerID <<= 8;
                manufacturerID |= unpackersData[unpackersData.currentIndex++];
              }
              const manufacturerInternalID = readVariableLengthQuantity(unpackersData);
              unpacker.manufacturerID = manufacturerID;
              unpacker.manufacturerInternalID = manufacturerInternalID;
            }
            break;
        }
        unpacker.decodedSize = readVariableLengthQuantity(unpackersData);
        this.nodeUnpackers.push(unpacker);
      }
    }
    binaryData.currentIndex = nodeStartIndex + headerLength;
    this.referenceTypeID = readVariableLengthQuantity(binaryData);
    this.nodeData = binaryData.slice(binaryData.currentIndex, nodeStartIndex + this.length);
    binaryData.currentIndex = nodeStartIndex + this.length;
    switch (this.referenceTypeID) {
      case referenceTypeIds.inLineResource:
        break;
      case referenceTypeIds.externalXMF:
      case referenceTypeIds.inFileNode:
      case referenceTypeIds.XMFFileURIandNodeID:
      case referenceTypeIds.externalFile:
      case referenceTypeIds.inFileResource:
        SpessaSynthGroupEnd();
        throw new Error(`Unsupported reference type: ${this.referenceTypeID}`);
      default:
        SpessaSynthGroupEnd();
        throw new Error(`Unknown reference type: ${this.referenceTypeID}`);
    }
    if (this.isFile) {
      if (this.packedContent) {
        const compressed = this.nodeData.slice(2);
        SpessaSynthInfo(`%cPacked content. Attempting to deflate. Target size: %c${this.nodeUnpackers[0].decodedSize}`, consoleColors.warn, consoleColors.value);
        try {
          this.nodeData = new IndexedByteArray(inf(compressed).buffer);
        } catch (error) {
          SpessaSynthGroupEnd();
          if (error instanceof Error) throw new Error(`Error unpacking XMF file contents: ${error.message}.`, { cause: error });
        }
      }
      const resourceFormat = this.metadata.resourceFormat;
      if (resourceFormat === void 0) SpessaSynthWarn("No resource format for this file node!");
      else {
        if (resourceFormat[0] !== formatTypeIDs.standard) {
          SpessaSynthInfo(`Non-standard formatTypeID: ${resourceFormat.toString()}`);
          this.resourceFormat = resourceFormat.toString();
        }
        const resourceFormatID = resourceFormat[1];
        if (Object.values(resourceFormatIDs).includes(resourceFormatID)) this.resourceFormat = Object.keys(resourceFormatIDs).find((k) => resourceFormatIDs[k] === resourceFormatID);
        else SpessaSynthInfo(`Unrecognized resource format: ${resourceFormatID}`);
      }
    } else {
      this.resourceFormat = "folder";
      while (this.nodeData.currentIndex < this.nodeData.length) {
        const nodeStartIndex2 = this.nodeData.currentIndex;
        const nodeLength = readVariableLengthQuantity(this.nodeData);
        const nodeData = this.nodeData.slice(nodeStartIndex2, nodeStartIndex2 + nodeLength);
        this.nodeData.currentIndex = nodeStartIndex2 + nodeLength;
        this.innerNodes.push(new XMFNode2(nodeData));
      }
    }
  }
  get isFile() {
    return this.itemCount === 0;
  }
};
function loadXMF(midi, binaryData) {
  midi.bankOffset = 0;
  const sanityCheck = readBinaryStringIndexed(binaryData, 4);
  if (sanityCheck !== "XMF_") {
    SpessaSynthGroupEnd();
    throw new SyntaxError(`Invalid XMF Header! Expected "_XMF", got "${sanityCheck}"`);
  }
  SpessaSynthGroup("%cParsing XMF file...", consoleColors.info);
  const version = readBinaryStringIndexed(binaryData, 4);
  SpessaSynthInfo(`%cXMF version: %c${version}`, consoleColors.info, consoleColors.recognized);
  if (version === "2.00") SpessaSynthInfo(`%cFile Type ID: %c${readBigEndianIndexed(binaryData, 4)}%c, File Type Revision ID: %c${readBigEndianIndexed(binaryData, 4)}`, consoleColors.info, consoleColors.recognized, consoleColors.info, consoleColors.recognized);
  readVariableLengthQuantity(binaryData);
  const metadataTableLength = readVariableLengthQuantity(binaryData);
  binaryData.currentIndex += metadataTableLength;
  binaryData.currentIndex = readVariableLengthQuantity(binaryData);
  const rootNode = new XMFNode(binaryData);
  let midiArray = void 0;
  const searchNode = (node) => {
    const checkMeta = (xmf, rmid) => {
      if (node.metadata[xmf] !== void 0 && typeof node.metadata[xmf] === "string") midi.rmidiInfo[rmid] = getStringBytes(node.metadata[xmf]);
    };
    checkMeta("nodeName", "name");
    checkMeta("title", "name");
    checkMeta("copyrightNotice", "copyright");
    checkMeta("comment", "comment");
    if (node.isFile) switch (node.resourceFormat) {
      default:
        return;
      case "DLS1":
      case "DLS2":
      case "DLS22":
      case "mobileDLS":
        SpessaSynthInfo("%cFound embedded DLS!", consoleColors.recognized);
        midi.embeddedSoundBank = node.nodeData.buffer;
        break;
      case "StandardMIDIFile":
      case "StandardMIDIFileType1":
        SpessaSynthInfo("%cFound embedded MIDI!", consoleColors.recognized);
        midiArray = node.nodeData;
        break;
    }
    else for (const n of node.innerNodes) searchNode(n);
  };
  searchNode(rootNode);
  SpessaSynthGroupEnd();
  if (!midiArray) throw new Error("No MIDI data in the XMF file!");
  return midiArray;
}
var MIDITrack = class MIDITrack2 {
  /**
  * The name of this track.
  */
  name = "";
  /**
  * The MIDI port number used by the track.
  */
  port = 0;
  /**
  * A set that contains the MIDI channels used by the track in the sequence.
  */
  channels = /* @__PURE__ */ new Set();
  /**
  * All the MIDI messages of this track.
  */
  events = [];
  static copyFrom(track) {
    const t = new MIDITrack2();
    t.copyFrom(track);
    return t;
  }
  copyFrom(track) {
    this.name = track.name;
    this.port = track.port;
    this.channels = new Set(track.channels);
    this.events = track.events.map((e) => new MIDIMessage(e.ticks, e.statusByte, new IndexedByteArray(e.data)));
  }
  /**
  * Adds an event to the track.
  * @param event The event to add.
  * @param index The index at which to add this event.
  * @deprecated Use addEvents instead
  */
  addEvent(event, index) {
    this.events.splice(index, 0, event);
  }
  /**
  * Adds events to the track.
  * @param index The index at which to add these event.
  * @param events The events to add.
  */
  addEvents(index, ...events) {
    this.events.splice(index, 0, ...events);
  }
  /**
  * Removes an event from the track.
  * @param index The index of the event to remove.
  */
  deleteEvent(index) {
    this.events.splice(index, 1);
  }
  /**
  * Appends an event to the end of the track.
  * @param event The event to add.
  */
  pushEvent(event) {
    this.events.push(event);
  }
};
function loadMIDIFromArrayBufferInternal(outputMIDI, arrayBuffer, fileName) {
  SpessaSynthGroupCollapsed(`%cParsing MIDI File...`, consoleColors.info);
  outputMIDI.fileName = fileName;
  const binaryData = new IndexedByteArray(arrayBuffer);
  let smfFileBinary;
  const readMIDIChunk = (fileByteArray) => {
    const type = readBinaryStringIndexed(fileByteArray, 4);
    const size = readBigEndianIndexed(fileByteArray, 4);
    const chunk = {
      type,
      size,
      data: new IndexedByteArray(size)
    };
    const dataSlice = fileByteArray.slice(fileByteArray.currentIndex, fileByteArray.currentIndex + chunk.size);
    chunk.data.set(dataSlice, 0);
    fileByteArray.currentIndex += chunk.size;
    return chunk;
  };
  const initialString = readBinaryString(binaryData, 4);
  if (initialString === "RIFF") {
    binaryData.currentIndex += 8;
    const rmid = readBinaryStringIndexed(binaryData, 4);
    if (rmid !== "RMID") {
      SpessaSynthGroupEnd();
      throw new SyntaxError(`Invalid RMIDI Header! Expected "RMID", got "${rmid}"`);
    }
    const riff = RIFFChunk.read(binaryData);
    if (riff.header !== "data") {
      SpessaSynthGroupEnd();
      throw new SyntaxError(`Invalid RMIDI Chunk header! Expected "data", got "${riff.header}"`);
    }
    smfFileBinary = riff.data;
    let isSF2RMIDI = false;
    let foundDbnk = false;
    while (binaryData.currentIndex < binaryData.length) {
      const startIndex = binaryData.currentIndex;
      const currentChunk = RIFFChunk.read(binaryData, true);
      if (currentChunk.header === "RIFF") {
        const type = readBinaryStringIndexed(currentChunk.data, 4).toLowerCase();
        if (type === "sfbk" || type === "sfpk" || type === "dls ") {
          SpessaSynthInfo("%cFound embedded soundbank!", consoleColors.recognized);
          outputMIDI.embeddedSoundBank = binaryData.slice(startIndex, startIndex + currentChunk.size).buffer;
        } else SpessaSynthWarn(`Unknown RIFF chunk: "${type}"`);
        if (type === "dls ") outputMIDI.isDLSRMIDI = true;
        else isSF2RMIDI = true;
      } else if (currentChunk.header === "LIST") {
        if (readBinaryStringIndexed(currentChunk.data, 4) === "INFO") {
          SpessaSynthInfo("%cFound RMIDI INFO chunk!", consoleColors.recognized);
          while (currentChunk.data.currentIndex < currentChunk.size) {
            const infoChunk = RIFFChunk.read(currentChunk.data, true);
            const headerTyped = infoChunk.header;
            const infoData = infoChunk.data;
            switch (headerTyped) {
              default:
                SpessaSynthWarn(`Unknown RMIDI Info: ${headerTyped}`);
                break;
              case "INAM":
                outputMIDI.rmidiInfo.name = infoData;
                break;
              case "IALB":
              case "IPRD":
                outputMIDI.rmidiInfo.album = infoData;
                break;
              case "ICRT":
              case "ICRD":
                outputMIDI.rmidiInfo.creationDate = infoData;
                break;
              case "IART":
                outputMIDI.rmidiInfo.artist = infoData;
                break;
              case "IGNR":
                outputMIDI.rmidiInfo.genre = infoData;
                break;
              case "IPIC":
                outputMIDI.rmidiInfo.picture = infoData;
                break;
              case "ICOP":
                outputMIDI.rmidiInfo.copyright = infoData;
                break;
              case "ICMT":
                outputMIDI.rmidiInfo.comment = infoData;
                break;
              case "IENG":
                outputMIDI.rmidiInfo.engineer = infoData;
                break;
              case "ISFT":
                outputMIDI.rmidiInfo.software = infoData;
                break;
              case "ISBJ":
                outputMIDI.rmidiInfo.subject = infoData;
                break;
              case "IENC":
                outputMIDI.rmidiInfo.infoEncoding = infoData;
                break;
              case "MENC":
                outputMIDI.rmidiInfo.midiEncoding = infoData;
                break;
              case "DBNK":
                outputMIDI.bankOffset = readLittleEndian(infoData, 2);
                foundDbnk = true;
                break;
            }
          }
        }
      }
    }
    if (isSF2RMIDI && !foundDbnk) outputMIDI.bankOffset = 1;
    if (outputMIDI.isDLSRMIDI) outputMIDI.bankOffset = 0;
    if (outputMIDI.embeddedSoundBank === void 0) outputMIDI.bankOffset = 0;
  } else if (initialString === "XMF_") smfFileBinary = loadXMF(outputMIDI, binaryData);
  else smfFileBinary = binaryData;
  const headerChunk = readMIDIChunk(smfFileBinary);
  if (headerChunk.type !== "MThd") {
    SpessaSynthGroupEnd();
    throw new SyntaxError(`Invalid MIDI Header! Expected "MThd", got "${headerChunk.type}"`);
  }
  if (headerChunk.size !== 6) {
    SpessaSynthGroupEnd();
    throw new RangeError(`Invalid MIDI header chunk size! Expected 6, got ${headerChunk.size}`);
  }
  outputMIDI.format = readBigEndianIndexed(headerChunk.data, 2);
  const trackCount = readBigEndianIndexed(headerChunk.data, 2);
  outputMIDI.timeDivision = readBigEndianIndexed(headerChunk.data, 2);
  for (let i = 0; i < trackCount; i++) {
    const track = new MIDITrack();
    const trackChunk = readMIDIChunk(smfFileBinary);
    if (trackChunk.type !== "MTrk") {
      SpessaSynthGroupEnd();
      throw new SyntaxError(`Invalid track header! Expected "MTrk" got "${trackChunk.type}"`);
    }
    let runningByte;
    let totalTicks = 0;
    if (outputMIDI.format === 2 && i > 0) totalTicks += outputMIDI.tracks[i - 1].events[outputMIDI.tracks[i - 1].events.length - 1].ticks;
    while (trackChunk.data.currentIndex < trackChunk.size) {
      totalTicks += readVariableLengthQuantity(trackChunk.data);
      const statusByteCheck = trackChunk.data[trackChunk.data.currentIndex];
      let statusByte;
      if (runningByte !== void 0 && statusByteCheck < 128) statusByte = runningByte;
      else if (statusByteCheck < 128) {
        SpessaSynthGroupEnd();
        throw new SyntaxError(`Unexpected byte with no running byte. (${statusByteCheck})`);
      } else statusByte = trackChunk.data[trackChunk.data.currentIndex++];
      const statusByteChannel = getChannel(statusByte);
      let eventDataLength;
      switch (statusByteChannel) {
        case -1:
          eventDataLength = 0;
          break;
        case -2:
          statusByte = trackChunk.data[trackChunk.data.currentIndex++];
          eventDataLength = readVariableLengthQuantity(trackChunk.data);
          break;
        case -3:
          eventDataLength = readVariableLengthQuantity(trackChunk.data);
          break;
        default:
          eventDataLength = dataBytesAmount[statusByte >> 4];
          runningByte = statusByte;
          break;
      }
      const eventData = new IndexedByteArray(eventDataLength);
      eventData.set(trackChunk.data.slice(trackChunk.data.currentIndex, trackChunk.data.currentIndex + eventDataLength), 0);
      const event = new MIDIMessage(totalTicks, statusByte, eventData);
      track.pushEvent(event);
      trackChunk.data.currentIndex += eventDataLength;
    }
    outputMIDI.tracks.push(track);
    SpessaSynthInfo(`%cParsed %c${outputMIDI.tracks.length}%c / %c${outputMIDI.tracks.length}`, consoleColors.info, consoleColors.value, consoleColors.info, consoleColors.value);
  }
  SpessaSynthInfo(`%cAll tracks parsed correctly!`, consoleColors.recognized);
  outputMIDI.flush(false);
  SpessaSynthGroupEnd();
}
function toISODateString(date) {
  return date.toISOString().split(".")[0] + "Z";
}
var translations = [/* @__PURE__ */ new Map([
  ["domingo", "Sunday"],
  ["segunda-feira", "Monday"],
  ["ter\xE7a-feira", "Tuesday"],
  ["quarta-feira", "Wednesday"],
  ["quinta-feira", "Thursday"],
  ["sexta-feira", "Friday"],
  ["s\xE1bado", "Saturday"],
  ["janeiro", "January"],
  ["fevereiro", "February"],
  ["mar\xE7o", "March"],
  ["abril", "April"],
  ["maio", "May"],
  ["junho", "June"],
  ["julho", "July"],
  ["agosto", "August"],
  ["setembro", "September"],
  ["outubro", "October"],
  ["novembro", "November"],
  ["dezembro", "December"]
])];
function tryTranslate(dateString) {
  for (const translation of translations) {
    let translated = dateString;
    for (const [pt, english] of translation.entries()) {
      const regex = new RegExp(pt, "gi");
      translated = translated.replace(regex, english);
    }
    const date = new Date(translated);
    if (!Number.isNaN(date.getTime())) return date;
  }
}
function tryDotted(dateString) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(dateString);
  if (match) {
    const day = Number.parseInt(match[1]);
    const month = Number.parseInt(match[2]) - 1;
    const year = Number.parseInt(match[3]);
    const date = new Date(year, month, day);
    if (!Number.isNaN(date.getTime())) return date;
  }
}
function tryAWE(dateString) {
  const match = /^(\d{1,2})\s{1,2}(\d{1,2})\s{1,2}(\d{2})$/.exec(dateString);
  if (match) {
    const day = match[1];
    const month = (Number.parseInt(match[2]) + 1).toString();
    const year = match[3];
    const date = /* @__PURE__ */ new Date(`${month}/${day}/${year}`);
    if (!Number.isNaN(date.getTime())) return date;
  }
}
function tryYear(dateString) {
  const match = /\b\d{4}\b/.exec(dateString);
  return match ? new Date(match[0]) : void 0;
}
function parseDateString(dateString) {
  dateString = dateString.trim();
  if (dateString.length === 0) return /* @__PURE__ */ new Date();
  const filtered = dateString.replaceAll(/\b(\d+)(st|nd|rd|th)\b/g, "$1").replace(/\s+at\s+/i, " ");
  const date = new Date(filtered);
  if (Number.isNaN(date.getTime())) {
    const translated = tryTranslate(dateString);
    if (translated) return translated;
    const dotted = tryDotted(dateString);
    if (dotted) return dotted;
    const awe = tryAWE(dateString);
    if (awe) return awe;
    const year = tryYear(dateString);
    if (year) return year;
    SpessaSynthWarn(`Invalid date: "${dateString}". Replacing with the current date!`);
    return /* @__PURE__ */ new Date();
  }
  return date;
}
var BasicMIDI = class BasicMIDI2 {
  /**
  * The tracks in the sequence.
  */
  tracks = [];
  /**
  * The time division of the sequence, representing the number of MIDI ticks per beat.
  */
  timeDivision = 480;
  /**
  * The duration of the sequence, in seconds.
  */
  duration = 0;
  /**
  * The tempo changes in the sequence, ordered from the last change to the first.
  * Each change is represented by an object with a MIDI tick position and a tempo value in beats per minute.
  */
  tempoChanges = [{
    ticks: 0,
    tempo: 120
  }];
  /**
  * Any extra metadata found in the file.
  * These messages were deemed "interesting" by the parsing algorithm
  */
  extraMetadata = [];
  /**
  * An array containing the lyrics of the sequence.
  */
  lyrics = [];
  /**
  * The tick position of the first note-on event in the MIDI sequence.
  */
  firstNoteOn = 0;
  /**
  * The MIDI key range used in the sequence, represented by a minimum and maximum note value.
  */
  keyRange = {
    min: 0,
    max: 127
  };
  /**
  * The tick position of the last voice event (such as note-on, note-off, or control change) in the sequence.
  */
  lastVoiceEventTick = 0;
  /**
  * An array of channel offsets for each MIDI port, using the SpessaSynth method.
  * The index is the port number and the value is the channel offset.
  */
  portChannelOffsetMap = [0];
  /**
  * The loop points (in ticks) of the sequence, including both start and end points.
  */
  loop = {
    start: 0,
    end: 0,
    type: "hard"
  };
  /**
  * The file name of the MIDI sequence, if provided during parsing.
  */
  fileName;
  /**
  * The format of the MIDI file, which can be 0, 1, or 2, indicating the type of the MIDI file.
  */
  format = 0;
  /**
  * The RMID (Resource-Interchangeable MIDI) info data, if the file is RMID formatted.
  * Otherwise, this object is empty.
  * Info type: Chunk data as a binary array.
  * Note that text chunks contain a terminal zero byte.
  */
  rmidiInfo = {};
  /**
  * The bank offset used for RMID files.
  */
  bankOffset = 0;
  /**
  * If the MIDI file is a Soft Karaoke file (.kar), this is set to true.
  * https://www.mixagesoftware.com/en/midikit/help/HTML/karaoke_formats.html
  */
  isKaraokeFile = false;
  /**
  * Indicates if this file is a Multi-Port MIDI file.
  */
  isMultiPort = false;
  /**
  * If the MIDI file is a DLS RMIDI file.
  */
  isDLSRMIDI = false;
  /**
  * The embedded sound bank in the MIDI file, represented as an ArrayBuffer, if available.
  */
  embeddedSoundBank;
  /**
  * The raw, encoded MIDI name, represented as a Uint8Array.
  * Useful when the MIDI file uses a different code page.
  * Undefined if no MIDI name could be found.
  */
  binaryName;
  /**
  * The encoding of the RMIDI info in file, if specified.
  */
  get infoEncoding() {
    const encodingInfo = this.rmidiInfo.infoEncoding;
    if (!encodingInfo) return;
    let lengthToRead = encodingInfo.byteLength;
    if (encodingInfo[encodingInfo.byteLength - 1] === 0) lengthToRead--;
    return readBinaryString(encodingInfo, lengthToRead);
  }
  /**
  * Loads a MIDI file (SMF, RMIDI, XMF) from a given ArrayBuffer.
  * @param arrayBuffer The ArrayBuffer containing the binary file data.
  * @param fileName The optional name of the file, will be used if the MIDI file does not have a name.
  */
  static fromArrayBuffer(arrayBuffer, fileName = "") {
    const mid = new BasicMIDI2();
    loadMIDIFromArrayBufferInternal(mid, arrayBuffer, fileName);
    return mid;
  }
  /**
  * Loads a MIDI file (SMF, RMIDI, XMF) from a given file.
  * @param file The file to load.
  */
  static async fromFile(file) {
    const mid = new BasicMIDI2();
    loadMIDIFromArrayBufferInternal(mid, await file.arrayBuffer(), file.name);
    return mid;
  }
  /**
  * Copies a MIDI.
  * @param mid The MIDI to copy.
  * @returns The copied MIDI.
  */
  static copyFrom(mid) {
    const m = new BasicMIDI2();
    m.copyFrom(mid);
    return m;
  }
  /**
  * Copies a MIDI.
  * @param mid The MIDI to copy.
  */
  copyFrom(mid) {
    this.copyMetadataFrom(mid);
    this.embeddedSoundBank = mid?.embeddedSoundBank?.slice(0) ?? void 0;
    this.tracks = mid.tracks.map((track) => MIDITrack.copyFrom(track));
  }
  /**
  * Converts MIDI ticks to time in seconds.
  * @param ticks The time in MIDI ticks.
  * @returns The time in seconds.
  */
  midiTicksToSeconds(ticks) {
    ticks = Math.max(ticks, 0);
    if (this.tempoChanges.length === 0) throw new Error("There are no tempo changes in the sequence. At least one is needed.");
    if (this.tempoChanges[this.tempoChanges.length - 1].ticks !== 0) throw new Error(`The last tempo change is not at 0 ticks. Got ${this.tempoChanges[this.tempoChanges.length - 1].ticks} ticks.`);
    let tempoIndex = this.tempoChanges.findIndex((v) => v.ticks <= ticks);
    let totalSeconds = 0;
    while (tempoIndex < this.tempoChanges.length) {
      const tempo = this.tempoChanges[tempoIndex++];
      const ticksSinceLastTempo = ticks - tempo.ticks;
      totalSeconds += ticksSinceLastTempo * 60 / (tempo.tempo * this.timeDivision);
      ticks = tempo.ticks;
    }
    return totalSeconds;
  }
  /**
  * Converts seconds to time in MIDI ticks.
  * @param seconds The time in seconds.
  * @returns The time in MIDI ticks.
  */
  secondsToMIDITicks(seconds) {
    seconds = Math.max(seconds, 0);
    if (seconds === 0) return 0;
    if (this.tempoChanges.length === 0) throw new Error("There are no tempo changes in the sequence. At least one is needed.");
    if (this.tempoChanges[this.tempoChanges.length - 1].ticks !== 0) throw new Error(`The last tempo change is not at 0 ticks. Got ${this.tempoChanges[this.tempoChanges.length - 1].ticks} ticks.`);
    let remainingSeconds = seconds;
    let totalTicks = 0;
    for (let i = this.tempoChanges.length - 1; i >= 0; i--) {
      const currentTempo = this.tempoChanges[i];
      const next = this.tempoChanges[i - 1];
      const ticksToNextTempo = next ? next.ticks - currentTempo.ticks : Infinity;
      const oneTickToSeconds = 60 / (currentTempo.tempo * this.timeDivision);
      const secondsToNextTempo = ticksToNextTempo * oneTickToSeconds;
      if (remainingSeconds <= secondsToNextTempo) {
        totalTicks += Math.round(remainingSeconds / oneTickToSeconds);
        return totalTicks;
      }
      totalTicks += ticksToNextTempo;
      remainingSeconds -= secondsToNextTempo;
    }
    return totalTicks;
  }
  /**
  * Gets the used programs and keys for this MIDI file with a given sound bank.
  * @param soundbank the sound bank.
  * @returns The output data is a key-value pair: preset -> Set<"key-velocity">
  */
  getUsedProgramsAndKeys(soundbank) {
    return getUsedProgramsAndKeys(this, soundbank);
  }
  /**
  * Preloads all voices for this sequence in a given synth.
  * This caches all the needed voices for playing back this sequencer, resulting in a smooth playback.
  * The sequencer calls this function by default when loading the songs.
  * @param synth
  */
  preloadSynth(synth) {
    SpessaSynthGroupCollapsed(`%cPreloading samples...`, consoleColors.info);
    const used = this.getUsedProgramsAndKeys(synth.soundBankManager);
    for (const [preset, combos] of used.entries()) {
      SpessaSynthInfo(`%cPreloading used samples on %c${preset.name}%c...`, consoleColors.info, consoleColors.recognized, consoleColors.info);
      for (const combo of combos) {
        const [midiNote, velocity] = combo.split("-").map(Number);
        synth.getVoicesForPreset(preset, midiNote, velocity);
      }
    }
    SpessaSynthGroupEnd();
  }
  /**
  * Updates all internal values of the MIDI.
  * @param sortEvents if the events should be sorted by ticks. Recommended to be true.
  */
  flush(sortEvents = true) {
    if (sortEvents) for (const t of this.tracks) t.events.sort((e1, e2) => e1.ticks - e2.ticks);
    this.parseInternal();
  }
  /**
  * Calculates all note times in seconds.
  * @param minDrumLength the shortest a drum note (channel 10) can be, in seconds.
  * @returns an array of 16 channels, each channel containing its notes,
  * with their key number, velocity, absolute start time and length in seconds.
  */
  getNoteTimes(minDrumLength = 0) {
    return getNoteTimesInternal(this, minDrumLength);
  }
  /**
  * Exports the midi as a standard MIDI file.
  * @returns the binary file data.
  */
  writeMIDI() {
    return writeMIDIInternal(this);
  }
  /**
  * Writes an RMIDI file. Note that this method modifies the MIDI file in-place.
  * @param soundBankBinary the binary sound bank to embed into the file.
  * @param configuration Extra options for writing the file.
  * @returns the binary file data.
  */
  writeRMIDI(soundBankBinary, configuration = DEFAULT_RMIDI_WRITE_OPTIONS) {
    return writeRMIDIInternal(this, soundBankBinary, fillWithDefaults(configuration, DEFAULT_RMIDI_WRITE_OPTIONS));
  }
  /**
  * Allows easy editing of the file by removing channels, changing programs,
  * changing controllers and transposing channels. Note that this modifies the MIDI *in-place*.
  * @param desiredProgramChanges - The programs to set on given channels.
  * @param controllerChanges - The controllers to set on given channels.
  * @param channelsToClear - The channels to remove from the sequence.
  * @param channelsToTranspose - The channels to transpose.
  * @param clearDrumParams - If the drum parameters should be cleared.
  * @param reverbParams - The desired GS reverb params, leave undefined for no change.
  * @param chorusParams - The desired GS chorus params, leave undefined for no change.
  * @param delayParams - The desired GS delay params, leave undefined for no change.
  */
  modify({ programChanges = [], controllerChanges = [], channelsToClear = [], channelsToTranspose = [], clearDrumParams = false, reverbParams, chorusParams, delayParams, insertionParams }) {
    modifyMIDIInternal(this, {
      programChanges,
      controllerChanges,
      channelsToClear,
      channelsToTranspose,
      clearDrumParams,
      reverbParams,
      chorusParams,
      delayParams,
      insertionParams
    });
  }
  /**
  * Modifies the sequence *in-place* according to the locked presets and controllers in the given snapshot.
  * @param snapshot the snapshot to apply.
  */
  applySnapshot(snapshot) {
    applySnapshotInternal(this, snapshot);
  }
  /**
  * Gets the MIDI's decoded name.
  * @param encoding The encoding to use if the MIDI uses an extended code page.
  * @remarks
  * Do not call in audioWorkletGlobalScope as it uses TextDecoder.
  * RMIDI encoding overrides the provided encoding.
  */
  getName(encoding = "Shift_JIS") {
    let rawName = "";
    const n = this.getRMIDInfo("name");
    if (n) return n.trim();
    if (this.binaryName) {
      encoding = this.getRMIDInfo("midiEncoding") ?? encoding;
      try {
        rawName = new TextDecoder(encoding).decode(this.binaryName).trim();
      } catch (error) {
        SpessaSynthWarn(`Failed to decode MIDI name: ${error}`);
      }
    }
    return rawName || this.fileName;
  }
  /**
  * Gets the decoded extra metadata as text and removes any unneeded characters (such as "@T" for karaoke files)
  * @param encoding The encoding to use if the MIDI uses an extended code page.
  * @remarks
  * Do not call in audioWorkletGlobalScope as it uses TextDecoder.
  * RMIDI encoding overrides the provided encoding.
  */
  getExtraMetadata(encoding = "Shift_JIS") {
    encoding = this.infoEncoding ?? encoding;
    const decoder = new TextDecoder(encoding);
    return this.extraMetadata.map((d) => {
      return decoder.decode(d.data).replaceAll(/@T|@A/g, "").trim();
    });
  }
  /**
  * Sets a given RMIDI info value.
  * @param infoType The type to set.
  * @param infoData The value to set it to.
  * @remarks
  * This sets the Info encoding to utf-8.
  */
  setRMIDInfo(infoType, infoData) {
    this.rmidiInfo.infoEncoding = getStringBytes("utf-8", true);
    if (infoType === "picture") this.rmidiInfo.picture = new Uint8Array(infoData);
    else if (infoType === "creationDate") this.rmidiInfo.creationDate = getStringBytes(toISODateString(infoData), true);
    else {
      const encoded = new TextEncoder().encode(infoData);
      this.rmidiInfo[infoType] = new Uint8Array([...encoded, 0]);
    }
  }
  /**
  * Gets a given chunk from the RMIDI information, undefined if it does not exist.
  * @param infoType The metadata type.
  * @returns String, Date, ArrayBuffer or undefined.
  */
  getRMIDInfo(infoType) {
    if (!this.rmidiInfo[infoType]) return;
    const encoding = this.infoEncoding ?? "UTF-8";
    if (infoType === "picture") return this.rmidiInfo[infoType].buffer;
    else if (infoType === "creationDate") return parseDateString(readBinaryString(this.rmidiInfo[infoType]));
    try {
      const decoder = new TextDecoder(encoding);
      let infoBuffer = this.rmidiInfo[infoType];
      if (infoBuffer[infoBuffer.length - 1] === 0) infoBuffer = infoBuffer?.slice(0, -1);
      return decoder.decode(infoBuffer.buffer).trim();
    } catch (error) {
      SpessaSynthWarn(`Failed to decode ${infoType} name: ${error}`);
      return;
    }
  }
  /**
  * Iterates over the MIDI file, ordered by the time the events happen.
  * @param callback The callback function to process each event.
  */
  iterate(callback) {
    const eventIndexes = new Array(this.tracks.length).fill(0);
    let remainingTracks = this.tracks.length;
    const findFirstEventIndex = () => {
      let index = 0;
      let ticks = Infinity;
      for (const [i, { events: track }] of this.tracks.entries()) {
        if (eventIndexes[i] >= track.length) continue;
        if (track[eventIndexes[i]].ticks < ticks) {
          index = i;
          ticks = track[eventIndexes[i]].ticks;
        }
      }
      return index;
    };
    while (remainingTracks > 0) {
      const trackNum = findFirstEventIndex();
      const track = this.tracks[trackNum].events;
      if (eventIndexes[trackNum] >= track.length) {
        remainingTracks--;
        continue;
      }
      const event = track[eventIndexes[trackNum]];
      callback(event, trackNum, eventIndexes);
      eventIndexes[trackNum]++;
    }
  }
  /**
  * INTERNAL USE ONLY!
  */
  copyMetadataFrom(mid) {
    this.fileName = mid.fileName;
    this.timeDivision = mid.timeDivision;
    this.duration = mid.duration;
    this.firstNoteOn = mid.firstNoteOn;
    this.lastVoiceEventTick = mid.lastVoiceEventTick;
    this.format = mid.format;
    this.bankOffset = mid.bankOffset;
    this.isKaraokeFile = mid.isKaraokeFile;
    this.isMultiPort = mid.isMultiPort;
    this.isDLSRMIDI = mid.isDLSRMIDI;
    this.isDLSRMIDI = mid.isDLSRMIDI;
    this.tempoChanges = [...mid.tempoChanges];
    this.extraMetadata = mid.extraMetadata.map((m) => new MIDIMessage(m.ticks, m.statusByte, new IndexedByteArray(m.data)));
    this.lyrics = mid.lyrics.map((arr) => new MIDIMessage(arr.ticks, arr.statusByte, new IndexedByteArray(arr.data)));
    this.portChannelOffsetMap = [...mid.portChannelOffsetMap];
    this.binaryName = mid?.binaryName?.slice();
    this.loop = { ...mid.loop };
    this.keyRange = { ...mid.keyRange };
    this.rmidiInfo = {};
    for (const v of Object.entries(mid.rmidiInfo)) {
      const key = v[0];
      const value = v[1];
      this.rmidiInfo[key] = new Uint8Array(value);
    }
  }
  /**
  * Parses internal MIDI values
  */
  parseInternal() {
    SpessaSynthGroup("%cInterpreting MIDI events...", consoleColors.info);
    let karaokeHasTitle = false;
    this.tempoChanges = [{
      ticks: 0,
      tempo: 120
    }];
    this.extraMetadata = [];
    this.lyrics = [];
    this.firstNoteOn = 0;
    this.keyRange = {
      max: 0,
      min: 127
    };
    this.lastVoiceEventTick = 0;
    this.portChannelOffsetMap = [0];
    this.loop = {
      start: 0,
      end: 0,
      type: "hard"
    };
    this.isKaraokeFile = false;
    this.isMultiPort = false;
    let nameDetected = false;
    if (this.rmidiInfo.name !== void 0) nameDetected = true;
    let loopStart = null;
    let loopEnd = null;
    let loopType = "hard";
    for (const track of this.tracks) {
      const usedChannels = /* @__PURE__ */ new Set();
      let trackHasVoiceMessages = false;
      for (let i = 0; i < track.events.length; i++) {
        const e = track.events[i];
        if (e.statusByte >= 128 && e.statusByte < 240) {
          trackHasVoiceMessages = true;
          if (e.ticks > this.lastVoiceEventTick) this.lastVoiceEventTick = e.ticks;
          switch (e.statusByte & 240) {
            case midiMessageTypes.controllerChange:
              switch (e.data[0]) {
                case 2:
                case 111:
                case 116:
                  loopStart = e.ticks;
                  break;
                case 4:
                case 117:
                  if (loopEnd === null) {
                    loopType = "soft";
                    loopEnd = e.ticks;
                  } else loopEnd = 0;
                  break;
                case 0:
                  if (this.isDLSRMIDI && e.data[1] !== 0 && e.data[1] !== 127) {
                    SpessaSynthInfo("%cDLS RMIDI with offset 1 detected!", consoleColors.recognized);
                    this.bankOffset = 1;
                  }
              }
              break;
            case midiMessageTypes.noteOn: {
              usedChannels.add(e.statusByte & 15);
              const note = e.data[0];
              this.keyRange.min = Math.min(this.keyRange.min, note);
              this.keyRange.max = Math.max(this.keyRange.max, note);
              break;
            }
          }
        }
        const eventText = readBinaryString(e.data);
        switch (e.statusByte) {
          case midiMessageTypes.endOfTrack:
            if (i !== track.events.length - 1) {
              track.deleteEvent(i);
              i--;
              SpessaSynthWarn("Unexpected EndOfTrack. Removing!");
            }
            break;
          case midiMessageTypes.setTempo:
            this.tempoChanges.push({
              ticks: e.ticks,
              tempo: 6e7 / readBigEndian(e.data, 3)
            });
            break;
          case midiMessageTypes.marker:
            switch (eventText.trim().toLowerCase()) {
              default:
                break;
              case "start":
              case "loopstart":
                loopStart = e.ticks;
                break;
              case "loopend":
                loopEnd = e.ticks;
            }
            break;
          case midiMessageTypes.copyright:
            this.extraMetadata.push(e);
            break;
          case midiMessageTypes.lyric:
            if (eventText.trim().startsWith("@KMIDI KARAOKE FILE")) {
              this.isKaraokeFile = true;
              SpessaSynthInfo("%cKaraoke MIDI detected!", consoleColors.recognized);
            }
            if (this.isKaraokeFile) e.statusByte = midiMessageTypes.text;
            else this.lyrics.push(e);
          case midiMessageTypes.text: {
            const checkedText = eventText.trim();
            if (checkedText.startsWith("@KMIDI KARAOKE FILE")) {
              this.isKaraokeFile = true;
              SpessaSynthInfo("%cKaraoke MIDI detected!", consoleColors.recognized);
            } else if (this.isKaraokeFile) {
              if (checkedText.startsWith("@T") || checkedText.startsWith("@A")) if (karaokeHasTitle) this.extraMetadata.push(e);
              else {
                this.binaryName = e.data.slice(2);
                karaokeHasTitle = true;
                nameDetected = true;
              }
              else if (!checkedText.startsWith("@")) this.lyrics.push(e);
            }
            break;
          }
        }
      }
      track.channels = usedChannels;
      track.name = "";
      const trackName = track.events.find((e) => e.statusByte === midiMessageTypes.trackName);
      if (trackName && this.tracks.indexOf(track) > 0) {
        track.name = readBinaryString(trackName.data);
        if (!trackHasVoiceMessages && !track.name.toLowerCase().includes("setup")) this.extraMetadata.push(trackName);
      }
    }
    this.tempoChanges.reverse();
    SpessaSynthInfo(`%cCorrecting loops, ports and detecting notes...`, consoleColors.info);
    const firstNoteOns = [];
    for (const t of this.tracks) {
      const firstNoteOn = t.events.find((e) => (e.statusByte & 240) === midiMessageTypes.noteOn);
      if (firstNoteOn) firstNoteOns.push(firstNoteOn.ticks);
    }
    this.firstNoteOn = Math.min(...firstNoteOns);
    SpessaSynthInfo(`%cFirst note-on detected at: %c${this.firstNoteOn}%c ticks!`, consoleColors.info, consoleColors.recognized, consoleColors.info);
    loopStart ??= this.firstNoteOn;
    if (loopEnd === null || loopEnd === 0) loopEnd = this.lastVoiceEventTick;
    this.loop = {
      start: loopStart,
      end: loopEnd,
      type: loopType
    };
    this.lastVoiceEventTick = Math.max(this.lastVoiceEventTick, this.loop.end);
    SpessaSynthInfo(`%cLoop points: start: %c${this.loop.start}%c end: %c${this.loop.end}`, consoleColors.info, consoleColors.recognized, consoleColors.info, consoleColors.recognized);
    let portOffset = 0;
    this.portChannelOffsetMap = [];
    for (const track of this.tracks) {
      track.port = -1;
      if (track.channels.size === 0) continue;
      for (const e of track.events) {
        if (e.statusByte !== midiMessageTypes.midiPort) continue;
        const port = e.data[0];
        track.port = port;
        if (this.portChannelOffsetMap[port] === void 0) {
          this.portChannelOffsetMap[port] = portOffset;
          portOffset += 16;
        }
      }
    }
    this.portChannelOffsetMap = [...this.portChannelOffsetMap].map((o) => o ?? 0);
    let defaultPort = Infinity;
    for (const track of this.tracks) if (track.port !== -1 && defaultPort > track.port) defaultPort = track.port;
    if (defaultPort === Infinity) defaultPort = 0;
    for (const track of this.tracks) if (track.port === -1 || track.port === void 0) track.port = defaultPort;
    if (this.portChannelOffsetMap.length === 0) this.portChannelOffsetMap = [0];
    if (this.portChannelOffsetMap.length < 2) SpessaSynthInfo(`%cNo additional MIDI Ports detected.`, consoleColors.info);
    else {
      this.isMultiPort = true;
      SpessaSynthInfo(`%cMIDI Ports detected!`, consoleColors.recognized);
    }
    if (!nameDetected) if (this.tracks.length > 1) {
      if (!this.tracks[0].events.some((message) => message.statusByte >= midiMessageTypes.noteOn && message.statusByte < midiMessageTypes.polyPressure)) {
        const name = this.tracks[0].events.find((message) => message.statusByte === midiMessageTypes.trackName);
        if (name) this.binaryName = name.data;
      }
    } else {
      const name = this.tracks[0].events.find((message) => message.statusByte === midiMessageTypes.trackName);
      if (name) this.binaryName = name.data;
    }
    this.extraMetadata = this.extraMetadata.filter((c) => c.data.length > 0);
    this.lyrics.sort((a, b) => a.ticks - b.ticks);
    if (!this.tracks.some((t) => t.events[0].ticks === 0)) {
      const track = this.tracks[0];
      let b = this?.binaryName?.buffer;
      if (!b) b = new Uint8Array(0).buffer;
      track.events.unshift(new MIDIMessage(0, midiMessageTypes.trackName, new IndexedByteArray(b)));
    }
    this.duration = this.midiTicksToSeconds(this.lastVoiceEventTick);
    if (this.binaryName?.length === 0) this.binaryName = void 0;
    SpessaSynthInfo(`%cMIDI file parsed. Total tick time: %c${this.lastVoiceEventTick}%c, total seconds time: %c${formatTime(Math.ceil(this.duration)).time}`, consoleColors.info, consoleColors.recognized, consoleColors.info, consoleColors.recognized);
    SpessaSynthGroupEnd();
  }
};
var generatorTypes = Object.freeze({
  INVALID: -1,
  startAddrsOffset: 0,
  endAddrOffset: 1,
  startloopAddrsOffset: 2,
  endloopAddrsOffset: 3,
  startAddrsCoarseOffset: 4,
  modLfoToPitch: 5,
  vibLfoToPitch: 6,
  modEnvToPitch: 7,
  initialFilterFc: 8,
  initialFilterQ: 9,
  modLfoToFilterFc: 10,
  modEnvToFilterFc: 11,
  endAddrsCoarseOffset: 12,
  modLfoToVolume: 13,
  unused1: 14,
  chorusEffectsSend: 15,
  reverbEffectsSend: 16,
  pan: 17,
  unused2: 18,
  unused3: 19,
  unused4: 20,
  delayModLFO: 21,
  freqModLFO: 22,
  delayVibLFO: 23,
  freqVibLFO: 24,
  delayModEnv: 25,
  attackModEnv: 26,
  holdModEnv: 27,
  decayModEnv: 28,
  sustainModEnv: 29,
  releaseModEnv: 30,
  keyNumToModEnvHold: 31,
  keyNumToModEnvDecay: 32,
  delayVolEnv: 33,
  attackVolEnv: 34,
  holdVolEnv: 35,
  decayVolEnv: 36,
  sustainVolEnv: 37,
  releaseVolEnv: 38,
  keyNumToVolEnvHold: 39,
  keyNumToVolEnvDecay: 40,
  instrument: 41,
  reserved1: 42,
  keyRange: 43,
  velRange: 44,
  startloopAddrsCoarseOffset: 45,
  keyNum: 46,
  velocity: 47,
  initialAttenuation: 48,
  reserved2: 49,
  endloopAddrsCoarseOffset: 50,
  coarseTune: 51,
  fineTune: 52,
  sampleID: 53,
  sampleModes: 54,
  reserved3: 55,
  scaleTuning: 56,
  exclusiveClass: 57,
  overridingRootKey: 58,
  unused5: 59,
  endOper: 60,
  amplitude: 61,
  vibLfoRate: 62,
  vibLfoAmplitudeDepth: 63,
  vibLfoToFilterFc: 64,
  modLfoRate: 65,
  modLfoAmplitudeDepth: 66
});
var GENERATORS_AMOUNT = Object.keys(generatorTypes).length;
var MAX_GENERATOR = Math.max(...Object.values(generatorTypes));
var generatorLimits = Object.freeze({
  [generatorTypes.startAddrsOffset]: {
    min: 0,
    max: 32768,
    def: 0,
    nrpn: 1
  },
  [generatorTypes.endAddrOffset]: {
    min: -32768,
    max: 32768,
    def: 0,
    nrpn: 1
  },
  [generatorTypes.startloopAddrsOffset]: {
    min: -32768,
    max: 32768,
    def: 0,
    nrpn: 1
  },
  [generatorTypes.endloopAddrsOffset]: {
    min: -32768,
    max: 32768,
    def: 0,
    nrpn: 1
  },
  [generatorTypes.startAddrsCoarseOffset]: {
    min: 0,
    max: 32768,
    def: 0,
    nrpn: 1
  },
  [generatorTypes.modLfoToPitch]: {
    min: -12e3,
    max: 12e3,
    def: 0,
    nrpn: 2
  },
  [generatorTypes.vibLfoToPitch]: {
    min: -12e3,
    max: 12e3,
    def: 0,
    nrpn: 2
  },
  [generatorTypes.modEnvToPitch]: {
    min: -12e3,
    max: 12e3,
    def: 0,
    nrpn: 2
  },
  [generatorTypes.initialFilterFc]: {
    min: 1500,
    max: 13500,
    def: 13500,
    nrpn: 2
  },
  [generatorTypes.initialFilterQ]: {
    min: 0,
    max: 960,
    def: 0,
    nrpn: 1
  },
  [generatorTypes.modLfoToFilterFc]: {
    min: -12e3,
    max: 12e3,
    def: 0,
    nrpn: 2
  },
  [generatorTypes.modEnvToFilterFc]: {
    min: -12e3,
    max: 12e3,
    def: 0,
    nrpn: 2
  },
  [generatorTypes.endAddrsCoarseOffset]: {
    min: -32768,
    max: 32768,
    def: 0,
    nrpn: 1
  },
  [generatorTypes.modLfoToVolume]: {
    min: -960,
    max: 960,
    def: 0,
    nrpn: 1
  },
  [generatorTypes.chorusEffectsSend]: {
    min: 0,
    max: 1e3,
    def: 0,
    nrpn: 1
  },
  [generatorTypes.reverbEffectsSend]: {
    min: 0,
    max: 1e3,
    def: 0,
    nrpn: 1
  },
  [generatorTypes.pan]: {
    min: -500,
    max: 500,
    def: 0,
    nrpn: 1
  },
  [generatorTypes.delayModLFO]: {
    min: -12e3,
    max: 5e3,
    def: -12e3,
    nrpn: 2
  },
  [generatorTypes.freqModLFO]: {
    min: -16e3,
    max: 4500,
    def: 0,
    nrpn: 4
  },
  [generatorTypes.delayVibLFO]: {
    min: -12e3,
    max: 5e3,
    def: -12e3,
    nrpn: 2
  },
  [generatorTypes.freqVibLFO]: {
    min: -16e3,
    max: 4500,
    def: 0,
    nrpn: 4
  },
  [generatorTypes.delayModEnv]: {
    min: -32768,
    max: 5e3,
    def: -32768,
    nrpn: 2
  },
  [generatorTypes.attackModEnv]: {
    min: -32768,
    max: 8e3,
    def: -32768,
    nrpn: 2
  },
  [generatorTypes.holdModEnv]: {
    min: -12e3,
    max: 5e3,
    def: -12e3,
    nrpn: 2
  },
  [generatorTypes.decayModEnv]: {
    min: -12e3,
    max: 8e3,
    def: -12e3,
    nrpn: 2
  },
  [generatorTypes.sustainModEnv]: {
    min: 0,
    max: 1e3,
    def: 0,
    nrpn: 1
  },
  [generatorTypes.releaseModEnv]: {
    min: -12e3,
    max: 8e3,
    def: -12e3,
    nrpn: 2
  },
  [generatorTypes.keyNumToModEnvHold]: {
    min: -1200,
    max: 1200,
    def: 0,
    nrpn: 1
  },
  [generatorTypes.keyNumToModEnvDecay]: {
    min: -1200,
    max: 1200,
    def: 0,
    nrpn: 1
  },
  [generatorTypes.delayVolEnv]: {
    min: -12e3,
    max: 5e3,
    def: -12e3,
    nrpn: 2
  },
  [generatorTypes.attackVolEnv]: {
    min: -12e3,
    max: 8e3,
    def: -12e3,
    nrpn: 2
  },
  [generatorTypes.holdVolEnv]: {
    min: -12e3,
    max: 5e3,
    def: -12e3,
    nrpn: 2
  },
  [generatorTypes.decayVolEnv]: {
    min: -12e3,
    max: 8e3,
    def: -12e3,
    nrpn: 2
  },
  [generatorTypes.sustainVolEnv]: {
    min: 0,
    max: 1440,
    def: 0,
    nrpn: 1
  },
  [generatorTypes.releaseVolEnv]: {
    min: -12e3,
    max: 8e3,
    def: -12e3,
    nrpn: 2
  },
  [generatorTypes.keyNumToVolEnvHold]: {
    min: -1200,
    max: 1200,
    def: 0,
    nrpn: 1
  },
  [generatorTypes.keyNumToVolEnvDecay]: {
    min: -1200,
    max: 1200,
    def: 0,
    nrpn: 1
  },
  [generatorTypes.startloopAddrsCoarseOffset]: {
    min: -32768,
    max: 32768,
    def: 0,
    nrpn: 1
  },
  [generatorTypes.keyNum]: {
    min: -1,
    max: 127,
    def: -1,
    nrpn: 1
  },
  [generatorTypes.velocity]: {
    min: -1,
    max: 127,
    def: -1,
    nrpn: 1
  },
  [generatorTypes.initialAttenuation]: {
    min: 0,
    max: 1440,
    def: 0,
    nrpn: 1
  },
  [generatorTypes.endloopAddrsCoarseOffset]: {
    min: -32768,
    max: 32768,
    def: 0,
    nrpn: 1
  },
  [generatorTypes.coarseTune]: {
    min: -120,
    max: 120,
    def: 0,
    nrpn: 1
  },
  [generatorTypes.fineTune]: {
    min: -12700,
    max: 12700,
    def: 0,
    nrpn: 1
  },
  [generatorTypes.scaleTuning]: {
    min: 0,
    max: 1200,
    def: 100,
    nrpn: 1
  },
  [generatorTypes.exclusiveClass]: {
    min: 0,
    max: 99999,
    def: 0,
    nrpn: 0
  },
  [generatorTypes.overridingRootKey]: {
    min: -1,
    max: 127,
    def: -1,
    nrpn: 0
  },
  [generatorTypes.sampleModes]: {
    min: 0,
    max: 3,
    def: 0,
    nrpn: 0
  },
  [generatorTypes.amplitude]: {
    min: -1e3,
    max: 1e3,
    def: 0,
    nrpn: 1
  },
  [generatorTypes.vibLfoRate]: {
    min: -1e3,
    max: 1e3,
    def: 0,
    nrpn: 1
  },
  [generatorTypes.vibLfoToFilterFc]: {
    min: -12e3,
    max: 12e3,
    def: 0,
    nrpn: 2
  },
  [generatorTypes.vibLfoAmplitudeDepth]: {
    min: 0,
    max: 1e3,
    def: 0,
    nrpn: 1
  },
  [generatorTypes.modLfoRate]: {
    min: -1e3,
    max: 1e3,
    def: 0,
    nrpn: 1
  },
  [generatorTypes.modLfoAmplitudeDepth]: {
    min: 0,
    max: 1e3,
    def: 0,
    nrpn: 1
  }
});
var defaultGeneratorValues = new Int16Array(GENERATORS_AMOUNT);
for (let i = 0; i < defaultGeneratorValues.length; i++) if (generatorLimits[i]) defaultGeneratorValues[i] = generatorLimits[i].def;
var sampleTypes = {
  monoSample: 1,
  rightSample: 2,
  leftSample: 4,
  linkedSample: 8,
  romMonoSample: 32769,
  romRightSample: 32770,
  romLeftSample: 32772,
  romLinkedSample: 32776
};
var modulatorSources = {
  noController: 0,
  noteOnVelocity: 2,
  noteOnKeyNum: 3,
  polyPressure: 10,
  channelPressure: 13,
  pitchWheel: 14,
  pitchWheelRange: 16,
  link: 127
};
var modulatorCurveTypes = {
  linear: 0,
  concave: 1,
  convex: 2,
  switch: 3
};
var dlsSources = {
  none: 0,
  modLfo: 1,
  velocity: 2,
  keyNum: 3,
  volEnv: 4,
  modEnv: 5,
  pitchWheel: 6,
  polyPressure: 7,
  channelPressure: 8,
  vibratoLfo: 9,
  modulationWheel: 129,
  volume: 135,
  pan: 138,
  expression: 139,
  chorus: 221,
  reverb: 219,
  pitchWheelRange: 256,
  fineTune: 257,
  coarseTune: 258
};
var dlsDestinations = {
  none: 0,
  gain: 1,
  reserved: 2,
  pitch: 3,
  pan: 4,
  keyNum: 5,
  chorusSend: 128,
  reverbSend: 129,
  modLfoFreq: 260,
  modLfoDelay: 261,
  vibLfoFreq: 276,
  vibLfoDelay: 277,
  volEnvAttack: 518,
  volEnvDecay: 519,
  reservedEG1: 520,
  volEnvRelease: 521,
  volEnvSustain: 522,
  volEnvDelay: 523,
  volEnvHold: 524,
  modEnvAttack: 778,
  modEnvDecay: 779,
  reservedEG2: 780,
  modEnvRelease: 781,
  modEnvSustain: 782,
  modEnvDelay: 783,
  modEnvHold: 784,
  filterCutoff: 1280,
  filterQ: 1281
};
var DLSLoopTypes = {
  forward: 0,
  loopAndRelease: 1
};
var defaultMIDIControllerValues = new Int16Array(147).fill(0);
var setResetValue = (i, v) => defaultMIDIControllerValues[i] = v << 7;
setResetValue(midiControllers.mainVolume, 100);
setResetValue(midiControllers.balance, 64);
setResetValue(midiControllers.expressionController, 127);
setResetValue(midiControllers.pan, 64);
setResetValue(midiControllers.portamentoOnOff, 127);
setResetValue(midiControllers.filterResonance, 64);
setResetValue(midiControllers.releaseTime, 64);
setResetValue(midiControllers.attackTime, 64);
setResetValue(midiControllers.brightness, 64);
setResetValue(midiControllers.decayTime, 64);
setResetValue(midiControllers.vibratoRate, 64);
setResetValue(midiControllers.vibratoDepth, 64);
setResetValue(midiControllers.vibratoDelay, 64);
setResetValue(midiControllers.generalPurposeController6, 64);
setResetValue(midiControllers.generalPurposeController8, 64);
setResetValue(midiControllers.registeredParameterLSB, 127);
setResetValue(midiControllers.registeredParameterMSB, 127);
setResetValue(midiControllers.nonRegisteredParameterLSB, 127);
setResetValue(midiControllers.nonRegisteredParameterMSB, 127);
setResetValue(128 + modulatorSources.pitchWheel, 64);
setResetValue(128 + modulatorSources.pitchWheelRange, 2);
var CUSTOM_CONTROLLER_TABLE_SIZE = Object.keys(customControllers).length;
var customResetArray = new Float32Array(CUSTOM_CONTROLLER_TABLE_SIZE);
customResetArray[customControllers.modulationMultiplier] = 1;
var drumReverbResetArray = new Int8Array(128).fill(127);
drumReverbResetArray[35] = 0;
drumReverbResetArray[36] = 0;
var nonResettableCCs = /* @__PURE__ */ new Set([
  midiControllers.bankSelect,
  midiControllers.bankSelectLSB,
  midiControllers.mainVolume,
  midiControllers.mainVolumeLSB,
  midiControllers.pan,
  midiControllers.panLSB,
  midiControllers.reverbDepth,
  midiControllers.tremoloDepth,
  midiControllers.chorusDepth,
  midiControllers.variationDepth,
  midiControllers.phaserDepth,
  midiControllers.soundVariation,
  midiControllers.filterResonance,
  midiControllers.releaseTime,
  midiControllers.attackTime,
  midiControllers.brightness,
  midiControllers.decayTime,
  midiControllers.vibratoRate,
  midiControllers.vibratoDepth,
  midiControllers.vibratoDelay,
  midiControllers.soundController10,
  midiControllers.polyModeOn,
  midiControllers.monoModeOn,
  midiControllers.omniModeOn,
  midiControllers.omniModeOff,
  midiControllers.dataEntryMSB,
  midiControllers.dataEntryLSB,
  midiControllers.nonRegisteredParameterLSB,
  midiControllers.nonRegisteredParameterMSB,
  midiControllers.registeredParameterLSB,
  midiControllers.registeredParameterMSB
]);
var defaultControllerArray = defaultMIDIControllerValues.slice(0, 128);
var nonSkippableCCs = /* @__PURE__ */ new Set([
  midiControllers.dataDecrement,
  midiControllers.dataIncrement,
  midiControllers.dataEntryMSB,
  midiControllers.dataEntryLSB,
  midiControllers.registeredParameterLSB,
  midiControllers.registeredParameterMSB,
  midiControllers.nonRegisteredParameterLSB,
  midiControllers.nonRegisteredParameterMSB,
  midiControllers.bankSelect,
  midiControllers.bankSelectLSB,
  midiControllers.resetAllControllers,
  midiControllers.monoModeOn,
  midiControllers.polyModeOn
]);
var stbvorbis = void 0 !== stbvorbis ? stbvorbis : {};
var isReady = false;
var readySolver;
stbvorbis.isInitialized = new Promise((A) => readySolver = A);
var atob = function(A) {
  var I, g, B, E, Q, C, i, h = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=", o = "", G = 0;
  A = A.replace(/[^A-Za-z0-9\+\/\=]/g, "");
  do
    E = h.indexOf(A.charAt(G++)), Q = h.indexOf(A.charAt(G++)), C = h.indexOf(A.charAt(G++)), i = h.indexOf(A.charAt(G++)), I = E << 2 | Q >> 4, g = (15 & Q) << 4 | C >> 2, B = (3 & C) << 6 | i, o += String.fromCharCode(I), 64 !== C && (o += String.fromCharCode(g)), 64 !== i && (o += String.fromCharCode(B));
  while (G < A.length);
  return o;
};
(function() {
  var A, I, g, B, E, Q, h, a, S, s, w, y, c, $ = void 0 !== $ ? $ : {};
  $.wasmBinary = Uint8Array.from(atob("AGFzbQEAAAABpQEYYAJ/fwF/YAF/AGAAAX9gBH9/f38AYAAAYAN/f38Bf2ABfwF/YAJ/fwBgBn9/f39/fwF/YAR/f39/AX9gBX9/f39/AX9gB39/f39/f38Bf2AGf39/f39/AGAIf39/f39/f38Bf2AFf39/f38AYAd/f39/f39/AGADf39/AGABfwF9YAF9AX1gAnx/AXxgAnx/AX9gA3x8fwF8YAJ8fAF8YAF8AXwCngIPA2VudgZtZW1vcnkCAIACA2VudgV0YWJsZQFwAQQEA2Vudgl0YWJsZUJhc2UDfwADZW52DkRZTkFNSUNUT1BfUFRSA38AA2VudghTVEFDS1RPUAN/AANlbnYJU1RBQ0tfTUFYA38ABmdsb2JhbAhJbmZpbml0eQN8AANlbnYFYWJvcnQAAQNlbnYNZW5sYXJnZU1lbW9yeQACA2Vudg5nZXRUb3RhbE1lbW9yeQACA2VudhdhYm9ydE9uQ2Fubm90R3Jvd01lbW9yeQACA2Vudg5fX19hc3NlcnRfZmFpbAADA2VudgtfX19zZXRFcnJObwABA2VudgZfYWJvcnQABANlbnYWX2Vtc2NyaXB0ZW5fbWVtY3B5X2JpZwAFA3d2BgYCAQcHAQIBAQcBCAcFAAkGCQoHBgYGBgEFBgIBBgYKAAgLAAYGBgYGBgYBAAoMDAMGBQANCAoJAAwODA8OAQAGBgcEABAJEAERAAADBQwAAAMHBxIGAQAABwIFEwMOBw8HBgYQFAoVExYXFxcXFgQFBQYFAAYkB38BIwELfwEjAgt/ASMDC38BQQALfwFBAAt8ASMEC38BQQALB9MCFRBfX2dyb3dXYXNtTWVtb3J5AAgRX19fZXJybm9fbG9jYXRpb24AYwVfZnJlZQBfB19tYWxsb2MAXgdfbWVtY3B5AHkHX21lbXNldAB6BV9zYnJrAHsXX3N0Yl92b3JiaXNfanNfY2hhbm5lbHMAJhRfc3RiX3ZvcmJpc19qc19jbG9zZQAlFV9zdGJfdm9yYmlzX2pzX2RlY29kZQAoE19zdGJfdm9yYmlzX2pzX29wZW4AJBpfc3RiX3ZvcmJpc19qc19zYW1wbGVfcmF0ZQAnC2R5bkNhbGxfaWlpAHwTZXN0YWJsaXNoU3RhY2tTcGFjZQAMC2dldFRlbXBSZXQwAA8LcnVuUG9zdFNldHMAeAtzZXRUZW1wUmV0MAAOCHNldFRocmV3AA0Kc3RhY2tBbGxvYwAJDHN0YWNrUmVzdG9yZQALCXN0YWNrU2F2ZQAKCQoBACMACwR9VFl9Csb2A3YGACAAQAALGwEBfyMGIQEjBiAAaiQGIwZBD2pBcHEkBiABCwQAIwYLBgAgACQGCwoAIAAkBiABJAcLEAAjCEUEQCAAJAggASQJCwsGACAAJAsLBAAjCwsRACAABEAgABARIAAgABASCwvvBwEKfyAAQYADaiEHIAcoAgAhBQJAIAUEQCAAQfwBaiEEIAQoAgAhASABQQBKBEAgAEHwAGohCANAIAUgAkEYbGpBEGohCSAJKAIAIQEgAQRAIAgoAgAhAyAFIAJBGGxqQQ1qIQogCi0AACEGIAZB/wFxIQYgAyAGQbAQbGpBBGohAyADKAIAIQMgA0EASgRAQQAhAwNAIAEgA0ECdGohASABKAIAIQEgACABEBIgA0EBaiEDIAgoAgAhASAKLQAAIQYgBkH/AXEhBiABIAZBsBBsakEEaiEBIAEoAgAhBiAJKAIAIQEgAyAGSA0ACwsgACABEBILIAUgAkEYbGpBFGohASABKAIAIQEgACABEBIgAkEBaiECIAQoAgAhASACIAFODQMgBygCACEFDAAACwALCwsgAEHwAGohAyADKAIAIQEgAQRAIABB7ABqIQUgBSgCACECIAJBAEoEQEEAIQIDQAJAIAEgAkGwEGxqQQhqIQQgBCgCACEEIAAgBBASIAEgAkGwEGxqQRxqIQQgBCgCACEEIAAgBBASIAEgAkGwEGxqQSBqIQQgBCgCACEEIAAgBBASIAEgAkGwEGxqQaQQaiEEIAQoAgAhBCAAIAQQEiABIAJBsBBsakGoEGohASABKAIAIQEgAUUhBCABQXxqIQFBACABIAQbIQEgACABEBIgAkEBaiECIAUoAgAhASACIAFODQAgAygCACEBDAELCyADKAIAIQELIAAgARASCyAAQfgBaiEBIAEoAgAhASAAIAEQEiAHKAIAIQEgACABEBIgAEGIA2ohAyADKAIAIQEgAQRAIABBhANqIQUgBSgCACECIAJBAEoEQEEAIQIDQCABIAJBKGxqQQRqIQEgASgCACEBIAAgARASIAJBAWohAiAFKAIAIQcgAygCACEBIAIgB0gNAAsLIAAgARASCyAAQQRqIQIgAigCACEBIAFBAEoEQEEAIQEDQCAAQZQGaiABQQJ0aiEDIAMoAgAhAyAAIAMQEiAAQZQHaiABQQJ0aiEDIAMoAgAhAyAAIAMQEiAAQdgHaiABQQJ0aiEDIAMoAgAhAyAAIAMQEiABQQFqIQEgAigCACEDIAEgA0ghAyABQRBJIQUgBSADcQ0ACwtBACEBA0AgAEGgCGogAUECdGohAiACKAIAIQIgACACEBIgAEGoCGogAUECdGohAiACKAIAIQIgACACEBIgAEGwCGogAUECdGohAiACKAIAIQIgACACEBIgAEG4CGogAUECdGohAiACKAIAIQIgACACEBIgAEHACGogAUECdGohAiACKAIAIQIgACACEBIgAUEBaiEBIAFBAkcNAAsLGwAgAEHEAGohACAAKAIAIQAgAEUEQCABEF8LC3wBAX8gAEHUB2ohASABQQA2AgAgAEGAC2ohASABQQA2AgAgAEH4CmohASABQQA2AgAgAEGcCGohASABQQA2AgAgAEHVCmohASABQQA6AAAgAEH8CmohASABQQA2AgAgAEHUC2ohASABQQA2AgAgAEHYC2ohACAAQQA2AgAL8AQBB38jBiELIwZBEGokBiALQQhqIQcgC0EEaiEKIAshCCAAQSRqIQYgBiwAACEGAn8gBgR/IABBgAtqIQYgBigCACEGIAZBf0oEQCAFQQA2AgAgACABIAIQFgwCCyAAQRRqIQYgBiABNgIAIAEgAmohAiAAQRxqIQkgCSACNgIAIABB2ABqIQIgAkEANgIAIABBABAXIQkgCUUEQCAFQQA2AgBBAAwCCyAAIAcgCCAKEBghCSAJBEAgBygCACECIAgoAgAhCSAKKAIAIQggACACIAkgCBAaIQogByAKNgIAIABBBGohAiACKAIAIQggCEEASgRAQQAhAgNAIABBlAZqIAJBAnRqIQcgBygCACEHIAcgCUECdGohByAAQdQGaiACQQJ0aiEMIAwgBzYCACACQQFqIQIgAiAISA0ACwsgAwRAIAMgCDYCAAsgBSAKNgIAIABB1AZqIQAgBCAANgIAIAYoAgAhACAAIAFrDAILAkACQAJAAkACQCACKAIAIgNBIGsOBAECAgACCyACQQA2AgAgAEHUAGohAiAAEBkhAwJAIANBf0cEQANAIAIoAgAhAyADDQIgABAZIQMgA0F/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ACECIABBmAhqIQYgBigCACEHIAUgA2shCSAJIAdqIQkgAiAJSSEJIAIgB0khDSACIAdrIQJBACACIA0bIQIgAiADaiECIAIgBUohByAFIAIgBxshAiAJBEAgASACNgIAIAYoAgAhACAAIAJqIQAgBiAANgIAQQEMBgsLCyAAQfQKaiECIAIoAgAhAiADIB9rIQYgBiACaiEGIABBmAhqIQIgAiAGNgIAIAhBATYCAAwBBSAAQZgIaiECIAYNAQsMAQsgBCADayEDIAIoAgAhBCADIARqIQMgAiADNgIACyATKAIAIQIgAgRAIABByABqIQIgAigCACECIABB0ABqIQAgACgCACEAIAIgAEcEQEHTE0HEE0HkGkHnFBAECwsgASAFNgIAQQELIQAgHCQGIAALqAIBBX8gAEHoCmohBSAFKAIAIQICQCACQQBIBEBBACEABSACIAFIBEAgAUEYSgRAIABBGBAsIQIgAUFoaiEBIAAgARAsIQAgAEEYdCEAIAAgAmohACAADwsgAkUEQCAAQeQKaiECIAJBADYCAAsgAEHkCmohAwJAAkACQANAIAAQLiECIAJBf0YNASAFKAIAIQQgAiAEdCECIAMoAgAhBiAGIAJqIQIgAyACNgIAIAUgBEEIaiICNgIAIAIgAUgNAAwCAAsACyAFQX82AgBBACEADAQLIARBeEgEQEEAIQAMBAsLCyAAQeQKaiEEIAQoAgAhA0EBIAF0IQAgAEF/aiEAIAMgAHEhACADIAF2IQMgBCADNgIAIAIgAWshASAFIAE2AgALCyAAC40CAAJAIABBAEgEf0EABSAAQYCAAUgEQCAAQRBIBEAgAEGACGohACAALAAAIQAMAwsgAEGABEgEQCAAQQV2IQAgAEGACGohACAALAAAIQAgAEEFaiEABSAAQQp2IQAgAEGACGohACAALAAAIQAgAEEKaiEACwwCCyAAQYCAgAhIBH8gAEGAgCBIBH8gAEEPdiEAIABBgAhqIQAgACwAACEAIABBD2oFIABBFHYhACAAQYAIaiEAIAAsAAAhACAAQRRqCwUgAEGAgICAAkgEfyAAQRl2IQAgAEGACGohACAALAAAIQAgAEEZagUgAEEediEAIABBgAhqIQAgACwAACEAIABBHmoLCwshAAsgAAuiAQEDfyAAQdQKaiECIAIsAAAhAQJAAkAgAQ0AIABB3ApqIQEgASgCACEBIAEEQEF/IQMFIAAQLyEBIAEEQCACLAAAIQEgAQ0CQaEUQcQTQfYLQbUUEAQFQX8hAwsLDAELIAFBf2pBGHRBGHUhASACIAE6AAAgAEHsCmohASABKAIAIQIgAkEBaiECIAEgAjYCACAAEDAhACAAQf8BcSEDCyADC6wCAQd/IABB3ApqIQIgAigCACEBAkAgAUUEQCAAQdgKaiEEIAQoAgAhASABQX9GBEAgAEHQCGohASABKAIAIQEgAUF/aiEBIABB4ApqIQMgAyABNgIAIAAQMSEBIAFFBEAgAkEBNgIADAMLIABB0wpqIQEgASwAACEBIAFBAXEhASABBH8gBCgCAAUgAEEgEBUMAwshAQsgAUEBaiEHIAQgBzYCACAAQdQIaiABaiEDIAMsAAAhBiAGQf8BcSEDIAZBf0cEQCACQQE2AgAgAEHgCmohAiACIAE2AgALIABB0AhqIQEgASgCACEBIAcgAU4EQCAEQX82AgALIABB1ApqIQAgACwAACEBIAEEQEHFFEHEE0HoC0HaFBAEBSAAIAY6AAAgAyEFCwsLIAULUQEDfyAAQRRqIQMgAygCACEBIABBHGohAiACKAIAIQIgASACSQR/IAFBAWohACADIAA2AgAgASwAAAUgAEHUAGohACAAQQE2AgBBAAshACAACyABAX8gABAyIQEgAQR/IAAQMwUgAEEeEBVBAAshACAAC2ABAX8gABAwIQEgAUH/AXFBzwBGBEAgABAwIQEgAUH/AXFB5wBGBEAgABAwIQEgAUH/AXFB5wBGBEAgABAwIQAgAEH/AXFB0wBGIQAFQQAhAAsFQQAhAAsFQQAhAAsgAAvZAwEGfyAAEDAhAQJ/IAFB/wFxBH8gAEEfEBVBAAUgABAwIQEgAEHTCmohAiACIAE6AAAgABAjIQUgABAjIQIgABAjGiAAECMhASAAQcwIaiEDIAMgATYCACAAECMaIAAQMCEBIAFB/wFxIQEgAEHQCGohAyADIAE2AgAgAEHUCGohBCAAIAQgARAiIQEgAUUEQCAAQQoQFUEADAILIABB8ApqIQQgBEF+NgIAIAIgBXEhAQJAIAFBf0cEQCADKAIAIQEgAUEASgRAA0ACQCABQX9qIQIgAEHUCGogAmohBiAGLAAAIQYgBkF/Rw0AIAFBAUwNBCACIQEMAQsLIAQgAjYCACAAQfQKaiEBIAEgBTYCAAsLCyAAQdUKaiEBIAEsAAAhASABBEAgAygCACEDIANBAEoEf0EAIQJBACEBA0AgAEHUCGogAWohBCAELQAAIQQgBEH/AXEhBCACIARqIQIgAUEBaiEBIAEgA0gNAAsgAkEbagVBGwshASAAQShqIQIgAigCACECIAEgA2ohASABIAJqIQEgAEEsaiEDIAMgAjYCACAAQTBqIQIgAiABNgIAIABBNGohASABIAU2AgALIABB2ApqIQAgAEEANgIAQQELCyEAIAALowEBB38gAEHoCmohAyADKAIAIQECQCABQRlIBEAgAEHkCmohBCABRQRAIARBADYCAAsgAEHUCmohBSAAQdwKaiEGA0AgBigCACEBIAEEQCAFLAAAIQEgAUUNAwsgABAuIQIgAkF/Rg0CIAMoAgAhASACIAF0IQIgBCgCACEHIAcgAmohAiAEIAI2AgAgAUEIaiECIAMgAjYCACABQRFIDQALCwsLrQUBCX8gABA0IAFBIGohAiACKAIAIQUCQAJAIAVFIgNFDQAgAUGkEGohAiACKAIAIQIgAg0AQX8hAQwBCyABQQRqIQIgAigCACECAkACQCACQQhKBEAgAUGkEGohAyADKAIAIQMgAw0BBSADDQELDAELIABB5ApqIQggCCgCACEJIAkQOiEHIAFBrBBqIQIgAigCACECIAJBAUoEQCABQaQQaigCACEKQQAhAwNAIAJBAXYhBSAFIANqIQQgCiAEQQJ0aiEGIAYoAgAhBiAGIAdLIQYgAiAFayECIAMgBCAGGyEDIAUgAiAGGyECIAJBAUoNAAsFQQAhAwsgAUEXaiECIAIsAAAhAiACRQRAIAFBqBBqIQIgAigCACECIAIgA0ECdGohAiACKAIAIQMLIAFBCGohASABKAIAIQEgASADaiEBIAEtAAAhASABQf8BcSEBIABB6ApqIQIgAigCACEAIAAgAUgEf0EAIQBBfwUgACABayEAIAkgAXYhASAIIAE2AgAgAwshASACIAA2AgAMAQsgAUEXaiEDIAMsAAAhAyADBEBBgRVBxBNB6gxBjBUQBAsCQCACQQBKBEAgASgCCCEIIABB5ApqIQlBACEBA0ACQCAIIAFqIQMgAywAACEEIARB/wFxIQMgBEF/RwRAIAUgAUECdGoh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IwZBEGokBiACIQECfCAAvUIgiKdB/////wdxIgNB/MOk/wNJBHwgA0GewZryA0kEfEQAAAAAAADwPwUgAEQAAAAAAAAAABByCwUgACAAoSADQf//v/8HSw0BGgJAAkACQAJAIAAgARBuQQNxDgMAAQIDCyABKwMAIAErAwgQcgwECyABKwMAIAErAwhBARBwmgwDCyABKwMAIAErAwgQcpoMAgsgASsDACABKwMIQQEQcAsLIQAgAiQGIAALywEBA38jBiECIwZBEGokBiACIQECQCAAvUIgiKdB/////wdxIgNB/MOk/wNJBEAgA0GAgMDyA08EQCAARAAAAAAAAAAAQQAQcCEACwUgA0H//7//B0sEQCAAIAChIQAMAgsCQAJAAkACQAJAIAAgARBuQQNxDgMAAQIDCyABKwMAIAErAwhBARBwIQAMBQsgASsDACABKwMIEHIhAAwECyABKwMAIAErAwhBARBwmiEADAMLIAErAwAgASsDCBBymiEACwsLIAIkBiAAC5sDAwJ/AX4CfCAAvSIDQj+IpyEBAnwCfwJAIANCIIinQf////8HcSICQarGmIQESwR8IANC////////////AINCgICAgICAgPj/AFYEQCAADwsgAETvOfr+Qi6GQGQEQCAARAAAAAAAAOB/og8FIABE0rx63SsjhsBjIABEUTAt1RBJh8BjcUUNAkQAAAAAAAAAACIADwsABSACQcLc2P4DSwRAIAJBscXC/wNLDQIgAUEBcyABawwDCyACQYCAwPEDSwR8QQAhASAABSAARAAAAAAAAPA/oA8LCwwCCyAARP6CK2VHFfc/oiABQQN0QYATaisDAKCqCyEBIAAgAbciBEQAAOD+Qi7mP6KhIgAgBER2PHk17znqPaIiBaELIQQgACAEIAQgBCAEoiIAIAAgACAAIABE0KS+cmk3Zj6iRPFr0sVBvbu+oKJELN4lr2pWET+gokSTvb4WbMFmv6CiRD5VVVVVVcU/oKKhIgCiRAAAAAAAAABAIAChoyAFoaBEAAAAAAAA8D+gIQAgAUUEQCAADwsgACABEGULnwMDAn8BfgV8IAC9IgNCIIinIQECfyADQgBTIgIgAUGAgMAASXIEfyADQv///////////wCDQgBRBEBEAAAAAAAA8L8gACAAoqMPCyACRQRAIABEAAAAAAAAUEOi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mgDjqR0AXmGRAAgb5gCFmWUAoBRfAI1AaACA2P8AJ3NNAAYGMQDKVhUAyahzAHviYABrjMAAQcMSC11A+yH5PwAAAAAtRHQ+AAAAgJhG+DwAAABgUcx4OwAAAICDG/A5AAAAQCAlejgAAACAIoLjNgAAAAAd82k1AAAAAAAA4D8AAAAAAADgvwAAAAAAAPA/AAAAAAAA+D8AQagTCwgG0M9D6/1MPgBBuxMLigZAA7jiP09nZ1MuL3N0Yl92b3JiaXMuYwBmLT5hbGxvYy5hbGxvY19idWZmZXJfbGVuZ3RoX2luX2J5dGVzID09IGYtPnRlbXBfb2Zmc2V0AHZvcmJpc19kZWNvZGVfaW5pdGlhbABmLT5ieXRlc19pbl9zZWcgPiAwAGdldDhfcGFja2V0X3JhdwBmLT5ieXRlc19pbl9zZWcgPT0gMABuZXh0X3NlZ21lbnQAdm9yYmlzX2RlY29kZV9wYWNrZXRfcmVzdAAhYy0+c3BhcnNlAGNvZGVib29rX2RlY29kZV9zY2FsYXJfcmF3ACFjLT5zcGFyc2UgfHwgeiA8IGMtPnNvcnRlZF9lbnRyaWVzAGNvZGVib29rX2RlY29kZV9kZWludGVybGVhdmVfcmVwZWF0AHogPCBjLT5zb3J0ZWRfZW50cmllcwBjb2RlYm9va19kZWNvZGVfc3RhcnQAKG4gJiAzKSA9PSAwAGltZGN0X3N0ZXAzX2l0ZXIwX2xvb3AAMABnZXRfd2luZG93AGYtPnRlbXBfb2Zmc2V0ID09IGYtPmFsbG9jLmFsbG9jX2J1ZmZlcl9sZW5ndGhfaW5fYnl0ZXMAc3RhcnRfZGVjb2RlcgB2b3JiaXNjLT5zb3J0ZWRfZW50cmllcyA9PSAwAGNvbXB1dGVfY29kZXdvcmRzAHogPj0gMCAmJiB6IDwgMzIAbGVuW2ldID49IDAgJiYgbGVuW2ldIDwgMzIAYXZhaWxhYmxlW3ldID09IDAAayA9PSBjLT5zb3J0ZWRfZW50cmllcwBjb21wdXRlX3NvcnRlZF9odWZmbWFuAGMtPnNvcnRlZF9jb2Rld29yZHNbeF0gPT0gY29kZQBsZW4gIT0gTk9fQ09ERQBpbmNsdWRlX2luX3NvcnQAcG93KChmbG9hdCkgcisxLCBkaW0pID4gZW50cmllcwBsb29rdXAxX3ZhbHVlcwAoaW50KSBmbG9vcihwb3coKGZsb2F0KSByLCBkaW0pKSA8PSBlbnRyaWVzAOoPBG5hbWUB4g9+AAVhYm9ydAENZW5sYXJnZU1lbW9yeQIOZ2V0VG90YWxNZW1vcnkDF2Fib3J0T25DYW5ub3RHcm93TWVtb3J5BA5fX19hc3NlcnRfZmFpbAULX19fc2V0RXJyTm8GBl9hYm9ydAcWX2Vtc2NyaXB0ZW5fbWVtY3B5X2JpZwgQX19ncm93V2FzbU1lbW9yeQkKc3RhY2tBbGxvYwoJc3RhY2tTYXZlCwxzdGFja1Jlc3RvcmUME2VzdGFibGlzaFN0YWNrU3BhY2UNCHNldFRocmV3DgtzZXRUZW1wUmV0MA8LZ2V0VGVtcFJldDAQEV9zdGJfdm9yYmlzX2Nsb3NlEQ5fdm9yYmlzX2RlaW5pdBILX3NldHVwX2ZyZWUTGl9zdGJfdm9yYmlzX2ZsdXNoX3B1c2hkYXRhFCFfc3RiX3ZvcmJpc19kZWNvZGVfZnJhbWVfcHVzaGRhdGEVBl9lcnJvchYgX3ZvcmJpc19zZWFyY2hfZm9yX3BhZ2VfcHVzaGRhdGEXGF9pc193aG9sZV9wYWNrZXRfcHJlc2VudBgVX3ZvcmJpc19kZWNvZGVfcGFja2V0GQxfZ2V0OF9wYWNrZXQaFF92b3JiaXNfZmluaXNoX2ZyYW1lGxlfc3RiX3ZvcmJpc19vcGVuX3B1c2hkYXRhHAxfdm9yYmlzX2luaXQdDl9zdGFydF9kZWNvZGVyHg1fdm9yYmlzX2FsbG9jHxtfc3RiX3ZvcmJpc19nZXRfZmlsZV9vZmZzZXQgE19tYXliZV9zdGFydF9wYWNrZXQhDV9mbHVzaF9wYWNrZXQiBV9nZXRuIwZfZ2V0MzIkE19zdGJfdm9yYmlzX2pzX29wZW4lFF9zdGJfdm9yYmlzX2pzX2Nsb3NlJhdfc3RiX3ZvcmJpc19qc19jaGFubmVscycaX3N0Yl92b3JiaXNfanNfc2FtcGxlX3JhdGUoFV9zdGJfdm9yYmlzX2pzX2RlY29kZSkNX2NyYzMyX3VwZGF0ZSoWX3ZvcmJpc19kZWNvZGVfaW5pdGlhbCsaX3ZvcmJpc19kZWNvZGVfcGFja2V0X3Jlc3QsCV9nZXRfYml0cy0FX2lsb2cuEF9nZXQ4X3BhY2tldF9yYXcvDV9uZXh0X3NlZ21lbnQwBV9nZXQ4MQtfc3RhcnRfcGFnZTIQX2NhcHR1cmVfcGF0dGVybjMdX3N0YXJ0X3BhZ2Vfbm9fY2FwdHVyZXBhdHRlcm40DV9wcmVwX2h1ZmZtYW41G19jb2RlYm9va19kZWNvZGVfc2NhbGFyX3JhdzYOX3ByZWRpY3RfcG9pbnQ3D19kZWNvZGVfcmVzaWR1ZTgJX2RvX2Zsb29yOQ1faW52ZXJzZV9tZGN0OgxfYml0X3JldmVyc2U7EV9tYWtlX2Jsb2NrX2FycmF5PBJfc2V0dXBfdGVtcF9tYWxsb2M9JF9jb2RlYm9va19kZWNvZGVfZGVpbnRlcmxlYXZlX3JlcGVhdD4PX3Jlc2lkdWVfZGVjb2RlPxVfY29kZWJvb2tfZGVjb2RlX3N0ZXBAEF9jb2RlYm9va19kZWNvZGVBFl9jb2RlYm9va19kZWNvZGVfc3RhcnRCCl9kcmF3X2xpbmVDF19pbWRjdF9zdGVwM19pdGVyMF9sb29wRBlfaW1kY3Rfc3RlcDNfaW5uZXJfcl9sb29wRRlfaW1kY3Rfc3RlcDNfaW5uZXJfc19sb29wRh9faW1kY3Rfc3RlcDNfaW5uZXJfc19sb29wX2xkNjU0RwhfaXRlcl81NEgLX2dldF93aW5kb3dJEF92b3JiaXNfdmFsaWRhdGVKDV9zdGFydF9wYWNrZXRLBV9za2lwTAtfY3JjMzJfaW5pdE0NX3NldHVwX21hbGxvY04QX3NldHVwX3RlbXBfZnJlZU8SX2NvbXB1dGVfY29kZXdvcmRzUBdfY29tcHV0ZV9zb3J0ZWRfaHVmZm1hblEcX2NvbXB1dGVfYWNjZWxlcmF0ZWRfaHVmZm1hblIPX2Zsb2F0MzJfdW5wYWNrUw9fbG9va3VwMV92YWx1ZXNUDl9wb2ludF9jb21wYXJlVQpfbmVpZ2hib3JzVg9faW5pdF9ibG9ja3NpemVXCl9hZGRfZW50cnlYEF9pbmNsdWRlX2luX3NvcnRZD191aW50MzJfY29tcGFyZVoYX2NvbXB1dGVfdHdpZGRsZV9mYWN0b3JzWw9fY29tcHV0ZV93aW5kb3dcE19jb21wdXRlX2JpdHJldmVyc2VdB19zcXVhcmVeB19tYWxsb2NfBV9mcmVlYAhfcmVhbGxvY2ESX3RyeV9yZWFsbG9jX2NodW5rYg5fZGlzcG9zZV9jaHVua2MRX19fZXJybm9fbG9jYXRpb25kB19tZW1jbXBlB19zY2FsYm5mBl9xc29ydGcFX3NpZnRoBF9zaHJpCF90cmlua2xlagRfc2hsawVfcG50emwIX2FfY3R6X2xtBl9jeWNsZW4LX19fcmVtX3BpbzJvEV9fX3JlbV9waW8yX2xhcmdlcAZfX19zaW5xBl9sZGV4cHIGX19fY29zcwRfY29zdARfc2ludQRfZXhwdgRfbG9ndwRfcG93eAtydW5Qb3N0U2V0c3kHX21lbWNweXoHX21lbXNldHsFX3Nicmt8C2R5bkNhbGxfaWlpfQJiMA=="), function(A4) {
    return A4.charCodeAt(0);
  });
  var $ = void 0 !== $ ? $ : {}, e = {};
  for (A in $) $.hasOwnProperty(A) && (e[A] = $[A]);
  $.arguments = [], $.thisProgram = "./this.program", $.quit = function(A4, I2) {
    throw I2;
  }, $.preRun = [], $.postRun = [];
  var t = false, k = false, N = false, r = false;
  t = "object" == typeof window, k = "function" == typeof importScripts, N = "object" == typeof process && "function" == typeof aaa && !t && !k, r = !t && !N && !k;
  var Y = "";
  function J(A4) {
    return $.locateFile ? $.locateFile(A4, Y) : Y + A4;
  }
  N ? (Y = "/", $.read = function A4(B2, E2) {
    var Q2;
    return I || (I = void 0), g || (g = void 0), B2 = g.normalize(B2), Q2 = I.readFileSync(B2), E2 ? Q2 : Q2.toString();
  }, $.readBinary = function A4(I2) {
    var g2 = $.read(I2, true);
    return g2.buffer || (g2 = new Uint8Array(g2)), _(g2.buffer), g2;
  }, process.argv.length > 1 && ($.thisProgram = process.argv[1].replace(/\\/g, "/")), $.arguments = process.argv.slice(2), process.on("uncaughtException", function(A4) {
    if (!(A4 instanceof II)) throw A4;
  }), process.on("unhandledRejection", function(A4, I2) {
    process.exit(1);
  }), $.quit = function(A4) {
    process.exit(A4);
  }, $.inspect = function() {
    return "[Emscripten Module object]";
  }) : r ? ("undefined" != typeof read && ($.read = function A4(I2) {
    return read(I2);
  }), $.readBinary = function A4(I2) {
    var g2;
    return "function" == typeof readbuffer ? new Uint8Array(readbuffer(I2)) : (_("object" == typeof (g2 = read(I2, "binary"))), g2);
  }, "undefined" != typeof scriptArgs ? $.arguments = scriptArgs : "undefined" != typeof arguments && ($.arguments = arguments), "function" == typeof quit && ($.quit = function(A4) {
    quit(A4);
  })) : (t || k) && (t ? document.currentScript && (Y = document.currentScript.src) : Y = self.location.href, Y = 0 !== Y.indexOf("blob:") ? Y.split("/").slice(0, -1).join("/") + "/" : "", $.read = function A4(I2) {
    var g2 = new XMLHttpRequest();
    return g2.open("GET", I2, false), g2.send(null), g2.responseText;
  }, k && ($.readBinary = function A4(I2) {
    var g2 = new XMLHttpRequest();
    return g2.open("GET", I2, false), g2.responseType = "arraybuffer", g2.send(null), new Uint8Array(g2.response);
  }), $.readAsync = function A4(I2, g2, B2) {
    var E2 = new XMLHttpRequest();
    E2.open("GET", I2, true), E2.responseType = "arraybuffer", E2.onload = function A8() {
      if (200 == E2.status || 0 == E2.status && E2.response) {
        g2(E2.response);
        return;
      }
      B2();
    }, E2.onerror = B2, E2.send(null);
  }, $.setWindowTitle = function(A4) {
    document.title = A4;
  });
  var f = $.print || ("undefined" != typeof console ? console.log.bind(console) : "undefined" != typeof print ? print : null), H = $.printErr || ("undefined" != typeof printErr ? printErr : "undefined" != typeof console && console.warn.bind(console) || f);
  for (A in e) e.hasOwnProperty(A) && ($[A] = e[A]);
  function L(A4) {
    var I2 = S;
    return S = S + A4 + 15 & -16, I2;
  }
  function d(A4, I2) {
    return I2 || (I2 = 16), A4 = Math.ceil(A4 / I2) * I2;
  }
  function K(A4) {
    K.shown || (K.shown = {}), K.shown[A4] || (K.shown[A4] = 1, H(A4));
  }
  e = void 0;
  var l = {
    "f64-rem": function(A4, I2) {
      return A4 % I2;
    },
    debugger: function() {
    }
  }, p = 0;
  function _(A4, I2) {
    A4 || IE("Assertion failed: " + I2);
  }
  function T(A4) {
    var I2 = $["_" + A4];
    return _(I2, "Cannot call unknown function " + A4 + ", make sure it is exported"), I2;
  }
  var v = {
    stackSave: function() {
      IA();
    },
    stackRestore: function() {
      A9();
    },
    arrayToC: function(A4) {
      var I2, g2, B2 = A5(A4.length);
      return I2 = A4, g2 = B2, E.set(I2, g2), B2;
    },
    stringToC: function(A4) {
      var I2 = 0;
      if (null != A4 && 0 !== A4) {
        var g2 = (A4.length << 2) + 1;
        I2 = A5(g2), Ai(A4, I2, g2);
      }
      return I2;
    }
  }, O = {
    string: v.stringToC,
    array: v.arrayToC
  };
  function j(A4, I2, g2, B2, E2) {
    var Q2 = T(A4), C = [], i = 0;
    if (B2) for (var h2 = 0; h2 < B2.length; h2++) {
      var o = O[g2[h2]];
      o ? (0 === i && (i = IA()), C[h2] = o(B2[h2])) : C[h2] = B2[h2];
    }
    var G, D = Q2.apply(null, C);
    return D = (G = D, "string" === I2 ? Ag(G) : "boolean" === I2 ? Boolean(G) : G), 0 !== i && A9(i), D;
  }
  function Ag(A4, I2) {
    if (0 === I2 || !A4) return "";
    for (var g2, B2, E2, C = 0, i = 0; C |= B2 = Q[A4 + i >> 0], (0 != B2 || I2) && (i++, !I2 || i != I2); ) ;
    I2 || (I2 = i);
    var h2 = "";
    if (C < 128) {
      for (; I2 > 0; ) E2 = String.fromCharCode.apply(String, Q.subarray(A4, A4 + Math.min(I2, 1024))), h2 = h2 ? h2 + E2 : E2, A4 += 1024, I2 -= 1024;
      return h2;
    }
    return g2 = A4, (function A8(I3, g3) {
      for (var B3 = g3; I3[B3]; ) ++B3;
      if (B3 - g3 > 16 && I3.subarray && AQ) return AQ.decode(I3.subarray(g3, B3));
      for (var E3, Q2, C2, i2, h3, G = ""; ; ) {
        if (!(E3 = I3[g3++])) return G;
        if (!(128 & E3)) {
          G += String.fromCharCode(E3);
          continue;
        }
        if (Q2 = 63 & I3[g3++], (224 & E3) == 192) {
          G += String.fromCharCode((31 & E3) << 6 | Q2);
          continue;
        }
        if (C2 = 63 & I3[g3++], (240 & E3) == 224 ? E3 = (15 & E3) << 12 | Q2 << 6 | C2 : (i2 = 63 & I3[g3++], (248 & E3) == 240 ? E3 = (7 & E3) << 18 | Q2 << 12 | C2 << 6 | i2 : (h3 = 63 & I3[g3++], E3 = (252 & E3) == 248 ? (3 & E3) << 24 | Q2 << 18 | C2 << 12 | i2 << 6 | h3 : (1 & E3) << 30 | Q2 << 24 | C2 << 18 | i2 << 12 | h3 << 6 | 63 & I3[g3++])), E3 < 65536) G += String.fromCharCode(E3);
        else {
          var D = E3 - 65536;
          G += String.fromCharCode(55296 | D >> 10, 56320 | 1023 & D);
        }
      }
    })(Q, g2);
  }
  var AQ = "undefined" != typeof TextDecoder ? new TextDecoder("utf8") : void 0;
  function AC(A4, I2, g2, B2) {
    if (!(B2 > 0)) return 0;
    for (var E2 = g2, Q2 = g2 + B2 - 1, C = 0; C < A4.length; ++C) {
      var i = A4.charCodeAt(C);
      if (i >= 55296 && i <= 57343 && (i = 65536 + ((1023 & i) << 10) | 1023 & A4.charCodeAt(++C)), i <= 127) {
        if (g2 >= Q2) break;
        I2[g2++] = i;
      } else if (i <= 2047) {
        if (g2 + 1 >= Q2) break;
        I2[g2++] = 192 | i >> 6, I2[g2++] = 128 | 63 & i;
      } else if (i <= 65535) {
        if (g2 + 2 >= Q2) break;
        I2[g2++] = 224 | i >> 12, I2[g2++] = 128 | i >> 6 & 63, I2[g2++] = 128 | 63 & i;
      } else if (i <= 2097151) {
        if (g2 + 3 >= Q2) break;
        I2[g2++] = 240 | i >> 18, I2[g2++] = 128 | i >> 12 & 63, I2[g2++] = 128 | i >> 6 & 63, I2[g2++] = 128 | 63 & i;
      } else if (i <= 67108863) {
        if (g2 + 4 >= Q2) break;
        I2[g2++] = 248 | i >> 24, I2[g2++] = 128 | i >> 18 & 63, I2[g2++] = 128 | i >> 12 & 63, I2[g2++] = 128 | i >> 6 & 63, I2[g2++] = 128 | 63 & i;
      } else {
        if (g2 + 5 >= Q2) break;
        I2[g2++] = 252 | i >> 30, I2[g2++] = 128 | i >> 24 & 63, I2[g2++] = 128 | i >> 18 & 63, I2[g2++] = 128 | i >> 12 & 63, I2[g2++] = 128 | i >> 6 & 63, I2[g2++] = 128 | 63 & i;
      }
    }
    return I2[g2] = 0, g2 - E2;
  }
  function Ai(A4, I2, g2) {
    return AC(A4, Q, I2, g2);
  }
  "undefined" != typeof TextDecoder && new TextDecoder("utf-16le");
  function An(A4, I2) {
    return A4 % I2 > 0 && (A4 += I2 - A4 % I2), A4;
  }
  function AU(A4) {
    $.buffer = B = A4;
  }
  function A$() {
    $.HEAP8 = E = new Int8Array(B), $.HEAP16 = new Int16Array(B), $.HEAP32 = h = new Int32Array(B), $.HEAPU8 = Q = new Uint8Array(B), $.HEAPU16 = new Uint16Array(B), $.HEAPU32 = new Uint32Array(B), $.HEAPF32 = new Float32Array(B), $.HEAPF64 = new Float64Array(B);
  }
  function Ae() {
    var A4 = $.usingWasm ? 65536 : 16777216, I2 = 2147483648 - A4;
    if (h[c >> 2] > I2) return false;
    var g2 = AN;
    for (AN = Math.max(AN, 16777216); AN < h[c >> 2]; ) AN = AN <= 536870912 ? An(2 * AN, A4) : Math.min(An((3 * AN + 2147483648) / 4, A4), I2);
    var B2 = $.reallocBuffer(AN);
    return B2 && B2.byteLength == AN ? (AU(B2), A$(), true) : (AN = g2, false);
  }
  a = S = s = w = y = c = 0, $.reallocBuffer || ($.reallocBuffer = function(A4) {
    try {
      if (ArrayBuffer.transfer) I2 = ArrayBuffer.transfer(B, A4);
      else {
        var I2, g2 = E;
        I2 = new ArrayBuffer(A4), new Int8Array(I2).set(g2);
      }
    } catch (Q2) {
      return false;
    }
    return !!Az(I2) && I2;
  });
  try {
    Function.prototype.call.bind(Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength").get)(/* @__PURE__ */ new ArrayBuffer(4));
  } catch (At) {
  }
  var Ak = $.TOTAL_STACK || 5242880, AN = $.TOTAL_MEMORY || 16777216;
  function Ar() {
    return AN;
  }
  function AY(A4) {
    for (; A4.length > 0; ) {
      var I2 = A4.shift();
      if ("function" == typeof I2) {
        I2();
        continue;
      }
      var g2 = I2.func;
      "number" == typeof g2 ? void 0 === I2.arg ? $.dynCall_v(g2) : $.dynCall_vi(g2, I2.arg) : g2(void 0 === I2.arg ? null : I2.arg);
    }
  }
  AN < Ak && H("TOTAL_MEMORY should be larger than TOTAL_STACK, was " + AN + "! (TOTAL_STACK=" + Ak + ")"), $.buffer ? B = $.buffer : ("object" == typeof WebAssembly && "function" == typeof WebAssembly.Memory ? ($.wasmMemory = new WebAssembly.Memory({ initial: AN / 65536 }), B = $.wasmMemory.buffer) : B = new ArrayBuffer(AN), $.buffer = B), A$();
  var AJ = [], Af = [], AH = [], AM = [], A0 = false;
  function Aq(A4) {
    AJ.unshift(A4);
  }
  function Ab(A4) {
    AM.unshift(A4);
  }
  var A6 = Math.floor, A7 = 0, A1 = null, AW = null;
  $.preloadedImages = {}, $.preloadedAudios = {};
  var AT = "data:application/octet-stream;base64,";
  function A2(A4) {
    return String.prototype.startsWith ? A4.startsWith(AT) : 0 === A4.indexOf(AT);
  }
  (function A4() {
    var I2 = "main.wast", g2 = "main.wasm", B2 = "main.temp.asm";
    A2(I2) || (I2 = J(I2)), A2(g2) || (g2 = J(g2)), A2(B2) || (B2 = J(B2));
    var E2 = {
      global: null,
      env: null,
      asm2wasm: l,
      parent: $
    }, Q2 = null;
    function i() {
      try {
        if ($.wasmBinary) return new Uint8Array($.wasmBinary);
        if ($.readBinary) return $.readBinary(g2);
        throw "both async and sync fetching of the wasm failed";
      } catch (A8) {
        IE(A8);
      }
    }
    $.asmPreload = $.asm;
    var h2 = $.reallocBuffer, o = function(A8) {
      A8 = An(A8, $.usingWasm ? 65536 : 16777216);
      var I3 = $.buffer.byteLength;
      if ($.usingWasm) try {
        if (-1 !== $.wasmMemory.grow((A8 - I3) / 65536)) return $.buffer = $.wasmMemory.buffer;
        return null;
      } catch (B3) {
        return null;
      }
    };
    $.reallocBuffer = function(A8) {
      return "asmjs" === G ? h2(A8) : o(A8);
    };
    var G = "";
    $.asm = function(A8, I3, B3) {
      if (!(I3 = I3).table) {
        var h3, o2 = $.wasmTableSize;
        void 0 === o2 && (o2 = 1024);
        var G2 = $.wasmMaxTableSize;
        "object" == typeof WebAssembly && "function" == typeof WebAssembly.Table ? void 0 !== G2 ? I3.table = new WebAssembly.Table({
          initial: o2,
          maximum: G2,
          element: "anyfunc"
        }) : I3.table = new WebAssembly.Table({
          initial: o2,
          element: "anyfunc"
        }) : I3.table = Array(o2), $.wasmTable = I3.table;
      }
      return I3.memoryBase || (I3.memoryBase = $.STATIC_BASE), I3.tableBase || (I3.tableBase = 0), h3 = (function A10(I4, B4, C) {
        if ("object" != typeof WebAssembly) return H("no native wasm support detected"), false;
        if (!($.wasmMemory instanceof WebAssembly.Memory)) return H("no native wasm Memory in use"), false;
        function h4(A11, I5) {
          if ((Q2 = A11.exports).memory) {
            var g3 = Q2.memory, B5 = $.buffer, E3;
            g3.byteLength < B5.byteLength && H("the new buffer in mergeMemory is smaller than the previous one. in native wasm, we should grow memory here"), E3 = new Int8Array(B5), new Int8Array(g3).set(E3), AU(g3), A$();
          }
          $.asm = Q2, $.usingWasm = true, (function A12(I6) {
            if (A7--, $.monitorRunDependencies && $.monitorRunDependencies(A7), 0 == A7 && (null !== A1 && (clearInterval(A1), A1 = null), AW)) {
              var g4 = AW;
              AW = null, g4();
            }
          })("wasm-instantiate");
        }
        B4.memory = $.wasmMemory, E2.global = {
          NaN: NaN,
          Infinity: Infinity
        }, E2["global.Math"] = Math, E2.env = B4;
        if (A7++, $.monitorRunDependencies && $.monitorRunDependencies(A7), $.instantiateWasm) try {
          return $.instantiateWasm(E2, h4);
        } catch (o3) {
          return H("Module.instantiateWasm callback failed with error: " + o3), false;
        }
        function G3(A11) {
          h4(A11.instance, A11.module);
        }
        function D(A11) {
          (!$.wasmBinary && (t || k) && "function" == typeof fetch ? fetch(g2, { credentials: "same-origin" }).then(function(A12) {
            if (!A12.ok) throw "failed to load wasm binary file at '" + g2 + "'";
            return A12.arrayBuffer();
          }).catch(function() {
            return i();
          }) : new Promise(function(A12, I5) {
            A12(i());
          })).then(function(A12) {
            return WebAssembly.instantiate(A12, E2);
          }).then(A11).catch(function(A12) {
            H("failed to asynchronously prepare wasm: " + A12), IE(A12);
          });
        }
        return $.wasmBinary || "function" != typeof WebAssembly.instantiateStreaming || A2(g2) || "function" != typeof fetch ? D(G3) : WebAssembly.instantiateStreaming(fetch(g2, { credentials: "same-origin" }), E2).then(G3).catch(function(A11) {
          H("wasm streaming compile failed: " + A11), H("falling back to ArrayBuffer instantiation"), D(G3);
        }), {};
      })(A8, I3, B3), _(h3, "no binaryen method succeeded."), h3;
    }, $.asm;
  })(), S = (a = 1024) + 4816, Af.push(), $.STATIC_BASE = a, $.STATIC_BUMP = 4816;
  var Av = S;
  S += 16, c = L(4), w = (s = d(S)) + Ak, y = d(w), h[c >> 2] = y, $.wasmTableSize = 4, $.wasmMaxTableSize = 4, $.asmGlobalArg = {}, $.asmLibraryArg = {
    abort: IE,
    assert: _,
    enlargeMemory: Ae,
    getTotalMemory: Ar,
    abortOnCannotGrowMemory: function A4() {
      IE("Cannot enlarge memory arrays. Either (1) compile with  -s TOTAL_MEMORY=X  with X higher than the current value " + AN + ", (2) compile with  -s ALLOW_MEMORY_GROWTH=1  which allows increasing the size at runtime, or (3) if you want malloc to return NULL (0) instead of this abort, compile with  -s ABORTING_MALLOC=0 ");
    },
    invoke_iii: function A4(I2, g2, B2) {
      var E2 = IA();
      try {
        return $.dynCall_iii(I2, g2, B2);
      } catch (Q2) {
        if (A9(E2), "number" != typeof Q2 && "longjmp" !== Q2) throw Q2;
        $.setThrew(1, 0);
      }
    },
    ___assert_fail: function A4(I2, g2, B2, E2) {
      IE("Assertion failed: " + Ag(I2) + ", at: " + [
        g2 ? Ag(g2) : "unknown filename",
        B2,
        E2 ? Ag(E2) : "unknown function"
      ]);
    },
    ___setErrNo: function A4(I2) {
      return $.___errno_location && (h[$.___errno_location() >> 2] = I2), I2;
    },
    _abort: function A4() {
      $.abort();
    },
    _emscripten_memcpy_big: function A4(I2, g2, B2) {
      return Q.set(Q.subarray(g2, g2 + B2), I2), I2;
    },
    _llvm_floor_f64: A6,
    DYNAMICTOP_PTR: c,
    tempDoublePtr: Av,
    ABORT: p,
    STACKTOP: s,
    STACK_MAX: w
  };
  var A3 = $.asm($.asmGlobalArg, $.asmLibraryArg, B);
  $.asm = A3, $.___errno_location = function() {
    return $.asm.___errno_location.apply(null, arguments);
  };
  var Az = $._emscripten_replace_memory = function() {
    return $.asm._emscripten_replace_memory.apply(null, arguments);
  };
  $._free = function() {
    return $.asm._free.apply(null, arguments);
  };
  $._malloc = function() {
    return $.asm._malloc.apply(null, arguments);
  };
  $._memcpy = function() {
    return $.asm._memcpy.apply(null, arguments);
  }, $._memset = function() {
    return $.asm._memset.apply(null, arguments);
  }, $._sbrk = function() {
    return $.asm._sbrk.apply(null, arguments);
  }, $._stb_vorbis_js_channels = function() {
    return $.asm._stb_vorbis_js_channels.apply(null, arguments);
  }, $._stb_vorbis_js_close = function() {
    return $.asm._stb_vorbis_js_close.apply(null, arguments);
  }, $._stb_vorbis_js_decode = function() {
    return $.asm._stb_vorbis_js_decode.apply(null, arguments);
  }, $._stb_vorbis_js_open = function() {
    return $.asm._stb_vorbis_js_open.apply(null, arguments);
  }, $._stb_vorbis_js_sample_rate = function() {
    return $.asm._stb_vorbis_js_sample_rate.apply(null, arguments);
  }, $.establishStackSpace = function() {
    return $.asm.establishStackSpace.apply(null, arguments);
  }, $.getTempRet0 = function() {
    return $.asm.getTempRet0.apply(null, arguments);
  }, $.runPostSets = function() {
    return $.asm.runPostSets.apply(null, arguments);
  }, $.setTempRet0 = function() {
    return $.asm.setTempRet0.apply(null, arguments);
  }, $.setThrew = function() {
    return $.asm.setThrew.apply(null, arguments);
  };
  var A5 = $.stackAlloc = function() {
    return $.asm.stackAlloc.apply(null, arguments);
  }, A9 = $.stackRestore = function() {
    return $.asm.stackRestore.apply(null, arguments);
  }, IA = $.stackSave = function() {
    return $.asm.stackSave.apply(null, arguments);
  };
  function II(A4) {
    this.name = "ExitStatus", this.message = "Program terminated with exit(" + A4 + ")", this.status = A4;
  }
  function Ig(A4) {
    if (A4 = A4 || $.arguments, !(A7 > 0)) (function A8() {
      if ($.preRun) for ("function" == typeof $.preRun && ($.preRun = [$.preRun]); $.preRun.length; ) Aq($.preRun.shift());
      AY(AJ);
    })(), !(A7 > 0) && ($.calledRun || ($.setStatus ? ($.setStatus("Running..."), setTimeout(function() {
      setTimeout(function() {
        $.setStatus("");
      }, 1), I2();
    }, 1)) : I2()));
    function I2() {
      !$.calledRun && ($.calledRun = true, p || (A0 || (A0 = true, AY(Af)), AY(AH), $.onRuntimeInitialized && $.onRuntimeInitialized(), (function A8() {
        if ($.postRun) for ("function" == typeof $.postRun && ($.postRun = [$.postRun]); $.postRun.length; ) Ab($.postRun.shift());
        AY(AM);
      })()));
    }
  }
  function IE(A4) {
    throw $.onAbort && $.onAbort(A4), void 0 !== A4 ? (f(A4), H(A4), A4 = JSON.stringify(A4)) : A4 = "", p = true, "abort(" + A4 + "). Build with -s ASSERTIONS=1 for more info.";
  }
  if ($.dynCall_iii = function() {
    return $.asm.dynCall_iii.apply(null, arguments);
  }, $.asm = A3, $.ccall = j, $.cwrap = function A4(I2, g2, B2, E2) {
    var Q2 = (B2 = B2 || []).every(function(A8) {
      return "number" === A8;
    });
    return "string" !== g2 && Q2 && !E2 ? T(I2) : function() {
      return j(I2, g2, B2, arguments, E2);
    };
  }, II.prototype = Error(), II.prototype.constructor = II, AW = function A4() {
    $.calledRun || Ig(), $.calledRun || (AW = A4);
  }, $.run = Ig, $.abort = IE, $.preInit) for ("function" == typeof $.preInit && ($.preInit = [$.preInit]); $.preInit.length > 0; ) $.preInit.pop()();
  $.noExitRuntime = true, Ig(), $.onRuntimeInitialized = () => {
    isReady = true, readySolver();
  }, stbvorbis.decode = function(A4) {
    return (function A8(I2) {
      if (!isReady) throw Error("SF3 decoder has not been initialized yet. Did you await synth.isReady?");
      var g2 = {};
      function B2(A10) {
        return new Int32Array($.HEAPU8.buffer, A10, 1)[0];
      }
      function E2(A10, I3) {
        var g3 = new ArrayBuffer(I3 * Float32Array.BYTES_PER_ELEMENT), B3 = new Float32Array(g3);
        return B3.set(new Float32Array($.HEAPU8.buffer, A10, I3)), B3;
      }
      g2.open = $.cwrap("stb_vorbis_js_open", "number", []), g2.close = $.cwrap("stb_vorbis_js_close", "void", ["number"]), g2.channels = $.cwrap("stb_vorbis_js_channels", "number", ["number"]), g2.sampleRate = $.cwrap("stb_vorbis_js_sample_rate", "number", ["number"]), g2.decode = $.cwrap("stb_vorbis_js_decode", "number", [
        "number",
        "number",
        "number",
        "number",
        "number"
      ]);
      var Q2, C, i, h2, o = g2.open(), G = (Q2 = I2, C = I2.byteLength, i = $._malloc(C), (h2 = new Uint8Array($.HEAPU8.buffer, i, C)).set(new Uint8Array(Q2, 0, C)), h2), D = $._malloc(4), a2 = $._malloc(4), S2 = g2.decode(o, G.byteOffset, G.byteLength, D, a2);
      if ($._free(G.byteOffset), S2 < 0) throw g2.close(o), $._free(D), Error("stbvorbis decode failed: " + S2);
      for (var F = g2.channels(o), R = Array(F), s2 = new Int32Array($.HEAPU32.buffer, B2(D), F), w2 = 0; w2 < F; w2++) R[w2] = E2(s2[w2], S2), $._free(s2[w2]);
      var y2 = g2.sampleRate(o);
      return g2.close(o), $._free(B2(D)), $._free(D), {
        data: R,
        sampleRate: y2,
        eof: true,
        error: null
      };
    })(A4);
  };
})();
var stb = stbvorbis;
var DrumParameters = class {
  /**
  * Pitch offset in cents.
  */
  pitch = 0;
  /**
  * Gain multiplier.
  */
  gain = 1;
  /**
  * Exclusive class override.
  */
  exclusiveClass = 0;
  /**
  * Pan, 1-64-127, 0 is random. This adds to the channel pan!
  */
  pan = 64;
  /**
  * Reverb multiplier.
  */
  reverbGain = 0;
  /**
  * Chorus multiplier.
  */
  chorusGain = 1;
  /**
  * Delay multiplier.
  */
  delayGain = 1;
  /**
  * If note on should be received.
  */
  rxNoteOn = true;
  /**
  * If note off should be received.
  * Note:
  * Due to the way sound banks implement drums (as 100s release time),
  * this means killing the voice on note off, not releasing it.
  */
  rxNoteOff = false;
  copyInto(p) {
    this.pitch = p.pitch;
    this.chorusGain = p.chorusGain;
    this.reverbGain = p.reverbGain;
    this.exclusiveClass = p.exclusiveClass;
    this.gain = p.gain;
    this.pan = p.pan;
    this.rxNoteOff = p.rxNoteOff;
    this.rxNoteOn = p.rxNoteOn;
    return this;
  }
};
var ChannelSnapshot = class ChannelSnapshot2 {
  /**
  * The MIDI patch that the channel is using.
  */
  patch;
  /**
  * Indicates whether the channel's program change is disabled.
  */
  lockPreset;
  /**
  * Indicates the MIDI system when the preset was locked
  */
  lockedSystem;
  /**
  * The array of all MIDI controllers (in 14-bit values) with the modulator sources at the end.
  */
  midiControllers;
  /**
  * An array of booleans, indicating if the controller with a current index is locked.
  */
  lockedControllers;
  /**
  * Array of custom (not SF2) control values such as RPN pitch tuning, transpose, modulation depth, etc.
  */
  customControllers;
  /**
  * The channel's vibrato settings.
  * @property depth Vibrato depth, in gain.
  * @property delay Vibrato delay from note on in seconds.
  * @property rate Vibrato rate in Hz.
  */
  channelVibrato;
  /**
  * Key shift for the channel.
  */
  keyShift;
  /**
  * The channel's octave tuning in cents.
  */
  octaveTuning;
  /**
  * Parameters for each drum instrument.
  */
  drumParams;
  /**
  * Indicates whether the channel is muted.
  */
  isMuted;
  /**
  * Indicates whether the channel is a drum channel.
  */
  drumChannel;
  /**
  * The channel number this snapshot represents.
  */
  channelNumber;
  constructor(patch, lockPreset, lockedSystem, midiControllers2, lockedControllers, customControllers2, channelVibrato, channelTransposeKeyShift, channelOctaveTuning, drumParams, isMuted, drumChannel, channelNumber) {
    this.patch = patch;
    this.lockPreset = lockPreset;
    this.lockedSystem = lockedSystem;
    this.midiControllers = midiControllers2;
    this.lockedControllers = lockedControllers;
    this.customControllers = customControllers2;
    this.channelVibrato = channelVibrato;
    this.keyShift = channelTransposeKeyShift;
    this.octaveTuning = channelOctaveTuning;
    this.drumParams = drumParams;
    this.isMuted = isMuted;
    this.drumChannel = drumChannel;
    this.channelNumber = channelNumber;
  }
  /**
  * Creates a copy of existing snapshot.
  * @param snapshot The snapshot to create a copy from.
  */
  static copyFrom(snapshot) {
    return new ChannelSnapshot2({ ...snapshot.patch }, snapshot.lockPreset, snapshot.lockedSystem, snapshot.midiControllers.slice(), [...snapshot.lockedControllers], snapshot.customControllers.slice(), { ...snapshot.channelVibrato }, snapshot.keyShift, snapshot.octaveTuning.slice(), snapshot.drumParams.map((d) => new DrumParameters().copyInto(d)), snapshot.isMuted, snapshot.drumChannel, snapshot.channelNumber);
  }
  /**
  * Creates a snapshot of the channel's state.
  * @param spessaSynthProcessor The synthesizer processor containing the channel.
  * @param channelNumber The channel number to take a snapshot of.
  */
  static create(spessaSynthProcessor, channelNumber) {
    const channelObject = spessaSynthProcessor.midiChannels[channelNumber];
    return new ChannelSnapshot2({
      ...channelObject.patch,
      name: channelObject?.preset?.name ?? "undefined"
    }, channelObject.lockPreset, channelObject.lockedSystem, channelObject.midiControllers.slice(), [...channelObject.lockedControllers], channelObject.customControllers.slice(), { ...channelObject.channelVibrato }, channelObject.keyShift, channelObject.octaveTuning.slice(), channelObject.drumParams.map((d) => new DrumParameters().copyInto(d)), channelObject.isMuted, channelObject.drumChannel, channelNumber);
  }
  /**
  * Applies the snapshot to the specified channel.
  * @param spessaSynthProcessor The processor containing the channel.
  */
  apply(spessaSynthProcessor) {
    const channelObject = spessaSynthProcessor.midiChannels[this.channelNumber];
    channelObject.muteChannel(this.isMuted);
    channelObject.setDrums(this.drumChannel);
    channelObject.midiControllers.set(this.midiControllers);
    channelObject.lockedControllers = this.lockedControllers;
    channelObject.customControllers.set(this.customControllers);
    channelObject.updateChannelTuning();
    channelObject.channelVibrato.rate = this.channelVibrato.rate;
    channelObject.channelVibrato.delay = this.channelVibrato.delay;
    channelObject.channelVibrato.depth = this.channelVibrato.depth;
    channelObject.keyShift = this.keyShift;
    channelObject.octaveTuning.set(this.octaveTuning);
    for (let i = 0; i < 128; i++) this.drumParams[i].copyInto(channelObject.drumParams[i]);
    channelObject.setPresetLock(false);
    channelObject.setPatch(this.patch);
    channelObject.setPresetLock(this.lockPreset);
    channelObject.lockedSystem = this.lockedSystem;
  }
};
var KeyModifier = class {
  /**
  * The new override velocity. -1 means unchanged.
  */
  velocity = -1;
  /**
  * The MIDI patch this key uses. -1 on any property means unchanged.
  */
  patch = {
    bankLSB: -1,
    bankMSB: -1,
    isGMGSDrum: false,
    program: -1
  };
  /**
  * Linear gain override for the voice.
  */
  gain = 1;
};
function sendAddress(s, a1, a2, a3, data, offset = 0) {
  const checksum = 128 - (a1 + a2 + a3 + data.reduce((sum, cur) => sum + cur, 0)) % 128 & 127;
  s.systemExclusive([
    65,
    16,
    66,
    18,
    a1,
    a2,
    a3,
    ...data,
    checksum,
    247
  ], offset);
}
var SynthesizerSnapshot = class SynthesizerSnapshot2 {
  /**
  * The individual channel snapshots.
  */
  channelSnapshots;
  /**
  * Key modifiers.
  */
  keyMappings;
  masterParameters;
  reverbSnapshot;
  chorusSnapshot;
  delaySnapshot;
  insertionSnapshot;
  constructor(channelSnapshots, masterParameters, keyMappings, reverbSnapshot, chorusSnapshot, delaySnapshot, insertionSnapshot) {
    this.channelSnapshots = channelSnapshots;
    this.masterParameters = masterParameters;
    this.keyMappings = keyMappings;
    this.reverbSnapshot = reverbSnapshot;
    this.chorusSnapshot = chorusSnapshot;
    this.delaySnapshot = delaySnapshot;
    this.insertionSnapshot = insertionSnapshot;
  }
  /**
  * Creates a new synthesizer snapshot from the given SpessaSynthProcessor.
  * @param processor the processor to take a snapshot of.
  * @returns The snapshot.
  */
  static create(processor) {
    return new SynthesizerSnapshot2(processor.midiChannels.map((_, i) => ChannelSnapshot.create(processor, i)), processor.getAllMasterParameters(), processor.keyModifierManager.getMappings(), processor.reverbProcessor.getSnapshot(), processor.chorusProcessor.getSnapshot(), processor.delayProcessor.getSnapshot(), processor.getInsertionSnapshot());
  }
  /**
  * Creates a copy of existing snapshot.
  * @param snapshot The snapshot to create a copy from.
  */
  static copyFrom(snapshot) {
    return new SynthesizerSnapshot2(snapshot.channelSnapshots.map((s) => ChannelSnapshot.copyFrom(s)), { ...snapshot.masterParameters }, [...snapshot.keyMappings], { ...snapshot.reverbSnapshot }, { ...snapshot.chorusSnapshot }, { ...snapshot.delaySnapshot }, { ...snapshot.insertionSnapshot });
  }
  /**
  * Applies the snapshot to the synthesizer.
  * @param processor the processor to apply the snapshot to.
  */
  apply(processor) {
    processor.keyModifierManager.setMappings(this.keyMappings);
    while (processor.midiChannels.length < this.channelSnapshots.length) processor.createMIDIChannel();
    for (const channelSnapshot of this.channelSnapshots) channelSnapshot.apply(processor);
    for (const [key, value] of Object.entries(this.reverbSnapshot)) processor.reverbProcessor[key] = value;
    for (const [key, value] of Object.entries(this.chorusSnapshot)) processor.chorusProcessor[key] = value;
    for (const [key, value] of Object.entries(this.delaySnapshot)) processor.delayProcessor[key] = value;
    const is = this.insertionSnapshot;
    sendAddress(processor, 64, 3, 0, [is.type >> 8, is.type & 127]);
    for (let i = 0; i < is.params.length; i++) if (is.params[i] !== 255) sendAddress(processor, 64, 3, 3 + i, [is.params[i]]);
    for (let channel = 0; channel < is.channels.length; channel++) sendAddress(processor, 64, 64 | channelToSyx(channel), 34, [is.channels[channel] ? 1 : 0]);
    const entries = Object.entries(this.masterParameters);
    for (const [parameter, value] of entries) processor.setMasterParameter(parameter, value);
  }
};
var DEFAULT_MASTER_PARAMETERS = {
  masterGain: 1,
  masterPan: 0,
  voiceCap: 350,
  interpolationType: interpolationTypes.hermite,
  midiSystem: "gs",
  monophonicRetriggerMode: false,
  reverbGain: 1,
  chorusGain: 1,
  delayGain: 1,
  reverbLock: false,
  chorusLock: false,
  delayLock: false,
  drumLock: false,
  customVibratoLock: false,
  nprnParamLock: false,
  insertionEffectLock: false,
  blackMIDIMode: false,
  autoAllocateVoices: false,
  transposition: 0,
  deviceID: -1
};
var MIN_TIMECENT = -15e3;
var timecentLookupTable = new Float32Array(15e3 - MIN_TIMECENT + 1);
for (let i = 0; i < timecentLookupTable.length; i++) {
  const timecents = MIN_TIMECENT + i;
  timecentLookupTable[i] = Math.pow(2, timecents / 1200);
}
var MIN_ABS_CENT = -2e4;
var MAX_ABS_CENT = 16500;
var absoluteCentLookupTable = new Float32Array(MAX_ABS_CENT - MIN_ABS_CENT + 1);
for (let i = 0; i < absoluteCentLookupTable.length; i++) {
  const absoluteCents = MIN_ABS_CENT + i;
  absoluteCentLookupTable[i] = 440 * Math.pow(2, (absoluteCents - 6900) / 1200);
}
var MIN_CENTIBELS = -16600;
var CENTIBEL_LOOKUP_TABLE = new Float32Array(16e3 - MIN_CENTIBELS + 1);
for (let i = 0; i < CENTIBEL_LOOKUP_TABLE.length; i++) {
  const centibels = MIN_CENTIBELS + i;
  CENTIBEL_LOOKUP_TABLE[i] = Math.pow(10, -centibels / 200);
}
var MODULATOR_RESOLUTION = 16384;
var MOD_CURVE_TYPES_AMOUNT = Object.keys(modulatorCurveTypes).length;
var concave = new Float32Array(MODULATOR_RESOLUTION + 1);
var convex = new Float32Array(MODULATOR_RESOLUTION + 1);
concave[0] = 0;
concave[concave.length - 1] = 1;
convex[0] = 0;
convex[convex.length - 1] = 1;
for (let i = 1; i < MODULATOR_RESOLUTION - 1; i++) {
  const x = -400 / 960 * Math.log(i / (concave.length - 1)) / Math.LN10;
  convex[i] = 1 - x;
  concave[concave.length - 1 - i] = x;
}
function getModulatorCurveValue(transformType, curveType, value) {
  const isBipolar = !!(transformType & 2);
  if (!!(transformType & 1)) value = 1 - value;
  switch (curveType) {
    case modulatorCurveTypes.linear:
      if (isBipolar) return value * 2 - 1;
      return value;
    case modulatorCurveTypes.switch:
      value = value > 0.5 ? 1 : 0;
      if (isBipolar) return value * 2 - 1;
      return value;
    case modulatorCurveTypes.concave:
      if (isBipolar) {
        value = value * 2 - 1;
        if (value < 0) return -concave[Math.trunc(value * -MODULATOR_RESOLUTION)];
        return concave[Math.trunc(value * MODULATOR_RESOLUTION)];
      }
      return concave[Math.trunc(value * MODULATOR_RESOLUTION)];
    case modulatorCurveTypes.convex:
      if (isBipolar) {
        value = value * 2 - 1;
        if (value < 0) return -convex[Math.trunc(value * -MODULATOR_RESOLUTION)];
        return convex[Math.trunc(value * MODULATOR_RESOLUTION)];
      }
      return convex[Math.trunc(value * MODULATOR_RESOLUTION)];
  }
}
var CONVEX_ATTACK = new Float32Array(1e3);
for (let i = 0; i < CONVEX_ATTACK.length; i++) CONVEX_ATTACK[i] = getModulatorCurveValue(0, modulatorCurveTypes.convex, i / 1e3);
function bitMaskToBool(num, bit) {
  return (num >> bit & 1) > 0;
}
function toNumericBool(bool) {
  return bool ? 1 : 0;
}
var ModulatorSource = class ModulatorSource2 {
  /**
  * If this field is set to false, the controller should be mapped with a minimum value of 0 and a maximum value of 1. This is also
  * called Unipolar. Thus, it behaves similar to the Modulation Wheel controller of the MIDI specification.
  *
  * If this field is set to true, the controller sound be mapped with a minimum value of -1 and a maximum value of 1. This is also
  * called Bipolar. Thus, it behaves similar to the Pitch Wheel controller of the MIDI specification.
  */
  isBipolar;
  /**
  * If this field is set true, the direction of the controller should be from the maximum value to the minimum value. So, for
  * example, if the controller source is Key Number, then a Key Number value of 0 corresponds to the maximum possible
  * controller output, and the Key Number value of 127 corresponds to the minimum possible controller input.
  */
  isNegative;
  /**
  * The index of the source.
  * It can point to one of the MIDI controllers or one of the predefined sources, depending on the 'isCC' flag.
  */
  index;
  /**
  * If this field is set to true, the MIDI Controller Palette is selected. The ‘index’ field value corresponds to one of the 128
  * MIDI Continuous Controller messages as defined in the MIDI specification.
  */
  isCC;
  /**
  * This field specifies how the minimum value approaches the maximum value.
  */
  curveType;
  constructor(index = modulatorSources.noController, curveType = modulatorCurveTypes.linear, isCC = false, isBipolar = false, isNegative = false) {
    this.isBipolar = isBipolar;
    this.isNegative = isNegative;
    this.index = index;
    this.isCC = isCC;
    this.curveType = curveType;
  }
  get sourceName() {
    return this.isCC ? Object.keys(midiControllers).find((k) => midiControllers[k] === this.index) ?? this.index.toString() : Object.keys(modulatorSources).find((k) => modulatorSources[k] === this.index) ?? this.index.toString();
  }
  get curveTypeName() {
    return Object.keys(modulatorCurveTypes).find((k) => modulatorCurveTypes[k] === this.curveType) ?? this.curveType.toString();
  }
  static fromSourceEnum(sourceEnum) {
    const isBipolar = bitMaskToBool(sourceEnum, 9);
    const isNegative = bitMaskToBool(sourceEnum, 8);
    const isCC = bitMaskToBool(sourceEnum, 7);
    return new ModulatorSource2(sourceEnum & 127, sourceEnum >> 10 & 3, isCC, isBipolar, isNegative);
  }
  /**
  * Copies the modulator source.
  * @param source The source to copy from.
  * @returns the copied source.
  */
  static copyFrom(source) {
    return new ModulatorSource2(source.index, source.curveType, source.isCC, source.isBipolar, source.isNegative);
  }
  toString() {
    return `${this.sourceName} ${this.curveTypeName} ${this.isBipolar ? "bipolar" : "unipolar"} ${this.isNegative ? "negative" : "positive"}`;
  }
  toSourceEnum() {
    return this.curveType << 10 | toNumericBool(this.isBipolar) << 9 | toNumericBool(this.isNegative) << 8 | toNumericBool(this.isCC) << 7 | this.index;
  }
  isIdentical(source) {
    return this.index === source.index && this.isNegative === source.isNegative && this.isCC === source.isCC && this.isBipolar === source.isBipolar && this.curveType === source.curveType;
  }
  /**
  * Gets the current value from this source.
  * @param midiControllers The MIDI controller + modulator source array.
  * @param pitchWheel the pitch wheel value, as channel determines if it's a per-note or a global value.
  * @param voice The voice to get the data for.
  */
  getValue(midiControllers2, pitchWheel, voice) {
    let rawValue;
    if (this.isCC) rawValue = midiControllers2[this.index];
    else switch (this.index) {
      case modulatorSources.noController:
        rawValue = 16383;
        break;
      case modulatorSources.noteOnKeyNum:
        rawValue = voice.midiNote << 7;
        break;
      case modulatorSources.noteOnVelocity:
        rawValue = voice.velocity << 7;
        break;
      case modulatorSources.polyPressure:
        rawValue = voice.pressure << 7;
        break;
      case modulatorSources.pitchWheel:
        rawValue = pitchWheel;
        break;
      default:
        rawValue = midiControllers2[this.index + 128];
        break;
    }
    const transformType = (this.isBipolar ? 2 : 0) | (this.isNegative ? 1 : 0);
    return precomputedModulatorTransforms[MODULATOR_RESOLUTION * (this.curveType * MOD_CURVE_TYPES_AMOUNT + transformType) + rawValue];
  }
};
var precomputedModulatorTransforms = new Float32Array(MODULATOR_RESOLUTION * 4 * MOD_CURVE_TYPES_AMOUNT);
for (let curveType = 0; curveType < MOD_CURVE_TYPES_AMOUNT; curveType++) for (let transformType = 0; transformType < 4; transformType++) {
  const tableIndex = MODULATOR_RESOLUTION * (curveType * MOD_CURVE_TYPES_AMOUNT + transformType);
  for (let value = 0; value < MODULATOR_RESOLUTION; value++) precomputedModulatorTransforms[tableIndex + value] = getModulatorCurveValue(transformType, curveType, value / MODULATOR_RESOLUTION);
}
function getModSourceEnum(curveType, isBipolar, isNegative, isCC, index) {
  return new ModulatorSource(index, curveType, isCC, isBipolar, isNegative).toSourceEnum();
}
var DEFAULT_RESONANT_MOD_SOURCE = getModSourceEnum(modulatorCurveTypes.linear, true, false, true, midiControllers.filterResonance);
var Modulator = class Modulator2 {
  /**
  * The generator destination of this modulator.
  */
  destination = generatorTypes.initialAttenuation;
  /**
  * The transform amount for this modulator.
  */
  transformAmount = 0;
  /**
  * The transform type for this modulator.
  */
  transformType = 0;
  /**
  * The primary source of this modulator.
  */
  primarySource;
  /**
  * The secondary source of this modulator.
  */
  secondarySource;
  /**
  * Creates a new SF2 Modulator
  */
  constructor(primarySource = new ModulatorSource(), secondarySource = new ModulatorSource(), destination = generatorTypes.INVALID, amount = 0, transformType = 0) {
    this.primarySource = primarySource;
    this.secondarySource = secondarySource;
    this.destination = destination;
    this.transformAmount = amount;
    this.transformType = transformType;
  }
  get destinationName() {
    return Object.keys(generatorTypes).find((k) => generatorTypes[k] === this.destination);
  }
  /**
  * Checks if the pair of modulators is identical (in SF2 terms)
  * @param mod1 modulator 1
  * @param mod2 modulator 2
  * @param checkAmount if the amount should be checked too.
  * @returns if they are identical
  */
  static isIdentical(mod1, mod2, checkAmount = false) {
    return mod1.primarySource.isIdentical(mod2.primarySource) && mod1.secondarySource.isIdentical(mod2.secondarySource) && mod1.destination === mod2.destination && mod1.transformType === mod2.transformType && (!checkAmount || mod1.transformAmount === mod2.transformAmount);
  }
  /**
  * Copies a modulator.
  * @param mod The modulator to copy.
  * @returns The copied modulator.
  */
  static copyFrom(mod) {
    return new Modulator2(ModulatorSource.copyFrom(mod.primarySource), ModulatorSource.copyFrom(mod.secondarySource), mod.destination, mod.transformAmount, mod.transformType);
  }
  toString() {
    return `Source: ${this.primarySource.toString()}
Secondary source: ${this.secondarySource.toString()}
to: ${this.destinationName}
amount: ${this.transformAmount}` + (this.transformType === 2 ? "absolute value" : "");
  }
  write(modData, indexes) {
    writeWord(modData, this.primarySource.toSourceEnum());
    writeWord(modData, this.destination);
    writeWord(modData, this.transformAmount);
    writeWord(modData, this.secondarySource.toSourceEnum());
    writeWord(modData, this.transformType);
    if (!indexes) return;
    indexes.mod++;
  }
  /**
  * Sums transform and create a NEW modulator
  * @param modulator the modulator to sum with
  * @returns the new modulator
  */
  sumTransform(modulator) {
    const m = Modulator2.copyFrom(this);
    m.transformAmount += modulator.transformAmount;
    return m;
  }
};
var DecodedModulator = class extends Modulator {
  /**
  * Reads an SF2 modulator
  * @param sourceEnum SF2 source enum
  * @param secondarySourceEnum SF2 secondary source enum
  * @param destination destination
  * @param amount amount
  * @param transformType transform type
  */
  constructor(sourceEnum, secondarySourceEnum, destination, amount, transformType) {
    super(ModulatorSource.fromSourceEnum(sourceEnum), ModulatorSource.fromSourceEnum(secondarySourceEnum), destination, amount, transformType);
    if (this.destination > MAX_GENERATOR) this.destination = generatorTypes.INVALID;
  }
};
var DEFAULT_ATTENUATION_MOD_CURVE_TYPE = modulatorCurveTypes.concave;
var defaultSoundFont2Modulators = [
  new DecodedModulator(getModSourceEnum(DEFAULT_ATTENUATION_MOD_CURVE_TYPE, false, true, false, modulatorSources.noteOnVelocity), 0, generatorTypes.initialAttenuation, 960, 0),
  new DecodedModulator(129, 0, generatorTypes.vibLfoToPitch, 50, 0),
  new DecodedModulator(getModSourceEnum(DEFAULT_ATTENUATION_MOD_CURVE_TYPE, false, true, true, midiControllers.mainVolume), 0, generatorTypes.initialAttenuation, 960, 0),
  new DecodedModulator(13, 0, generatorTypes.vibLfoToPitch, 50, 0),
  new DecodedModulator(526, 16, generatorTypes.fineTune, 12700, 0),
  new DecodedModulator(650, 0, generatorTypes.pan, 500, 0),
  new DecodedModulator(getModSourceEnum(DEFAULT_ATTENUATION_MOD_CURVE_TYPE, false, true, true, midiControllers.expressionController), 0, generatorTypes.initialAttenuation, 960, 0),
  new DecodedModulator(219, 0, generatorTypes.reverbEffectsSend, 200, 0),
  new DecodedModulator(221, 0, generatorTypes.chorusEffectsSend, 200, 0)
];
var defaultSpessaSynthModulators = [
  new DecodedModulator(getModSourceEnum(modulatorCurveTypes.convex, true, false, true, midiControllers.attackTime), 0, generatorTypes.attackVolEnv, 6e3, 0),
  new DecodedModulator(getModSourceEnum(modulatorCurveTypes.linear, true, false, true, midiControllers.releaseTime), 0, generatorTypes.releaseVolEnv, 3600, 0),
  new DecodedModulator(getModSourceEnum(modulatorCurveTypes.linear, true, false, true, midiControllers.decayTime), 0, generatorTypes.decayVolEnv, 3600, 0),
  new DecodedModulator(getModSourceEnum(modulatorCurveTypes.linear, true, false, true, midiControllers.brightness), 0, generatorTypes.initialFilterFc, 9600, 0),
  new DecodedModulator(DEFAULT_RESONANT_MOD_SOURCE, 0, generatorTypes.initialFilterQ, 200, 0),
  new DecodedModulator(getModSourceEnum(modulatorCurveTypes.switch, false, false, true, midiControllers.softPedal), 0, generatorTypes.initialAttenuation, 50, 0),
  new DecodedModulator(getModSourceEnum(modulatorCurveTypes.switch, false, false, true, midiControllers.softPedal), 0, generatorTypes.initialFilterFc, -2400, 0),
  new DecodedModulator(getModSourceEnum(modulatorCurveTypes.linear, true, false, true, midiControllers.balance), 0, generatorTypes.pan, 500, 0)
];
var SPESSASYNTH_DEFAULT_MODULATORS = [...defaultSoundFont2Modulators, ...defaultSpessaSynthModulators];
var Generator = class {
  /**
  * The generator's SF2 type.
  */
  generatorType;
  /**
  * The generator's 16-bit value.
  */
  generatorValue = 0;
  /**
  * Constructs a new generator
  * @param type generator type
  * @param value generator value
  * @param validate if the limits should be validated and clamped.
  */
  constructor(type, value, validate = true) {
    this.generatorType = type;
    if (value === void 0) throw new Error("No value provided.");
    this.generatorValue = Math.round(value);
    if (validate) {
      const lim = generatorLimits[type];
      if (lim !== void 0) this.generatorValue = Math.max(lim.min, Math.min(lim.max, this.generatorValue));
    }
  }
  write(genData) {
    writeWord(genData, this.generatorType);
    writeWord(genData, this.generatorValue);
  }
  toString() {
    return `${Object.keys(generatorTypes).find((k) => generatorTypes[k] === this.generatorType)}: ${this.generatorValue}`;
  }
};
var BasicZone = class {
  /**
  * The zone's velocity range.
  * min -1 means that it is a default value
  */
  velRange = {
    min: -1,
    max: 127
  };
  /**
  * The zone's key range.
  * min -1 means that it is a default value.
  */
  keyRange = {
    min: -1,
    max: 127
  };
  /**
  * The zone's generators.
  */
  generators = [];
  /**
  * The zone's modulators.
  */
  modulators = [];
  get hasKeyRange() {
    return this.keyRange.min !== -1;
  }
  get hasVelRange() {
    return this.velRange.min !== -1;
  }
  /**
  * The current tuning in cents, taking in both coarse and fine generators.
  */
  get fineTuning() {
    const currentCoarse = this.getGenerator(generatorTypes.coarseTune, 0);
    const currentFine = this.getGenerator(generatorTypes.fineTune, 0);
    return currentCoarse * 100 + currentFine;
  }
  /**
  * The current tuning in cents, taking in both coarse and fine generators.
  */
  set fineTuning(tuningCents) {
    const coarse = Math.trunc(tuningCents / 100);
    const fine = tuningCents % 100;
    this.setGenerator(generatorTypes.coarseTune, coarse);
    this.setGenerator(generatorTypes.fineTune, fine);
  }
  /**
  * Adds to a given generator, or its default value.
  * @param type the generator type.
  * @param value the value to add.
  * @param validate if the value should be clamped to allowed limits.
  */
  addToGenerator(type, value, validate = true) {
    const genValue = this.getGenerator(type, generatorLimits[type].def);
    this.setGenerator(type, value + genValue, validate);
  }
  /**
  * Sets a generator to a given value if preset, otherwise adds a new one.
  * @param type the generator type.
  * @param value the value to set. Set to null to remove this generator (set as "unset").
  * @param validate if the value should be clamped to allowed limits.
  */
  setGenerator(type, value, validate = true) {
    switch (type) {
      case generatorTypes.sampleID:
        throw new Error("Use setSample()");
      case generatorTypes.instrument:
        throw new Error("Use setInstrument()");
      case generatorTypes.velRange:
      case generatorTypes.keyRange:
        throw new Error("Set the range manually");
    }
    if (value === null) {
      this.generators = this.generators.filter((g) => g.generatorType !== type);
      return;
    }
    const index = this.generators.findIndex((g) => g.generatorType === type);
    if (index === -1) this.addGenerators(new Generator(type, value, validate));
    else this.generators[index] = new Generator(type, value, validate);
  }
  /**
  * Adds generators to the zone.
  * @param generators the generators to add.
  */
  addGenerators(...generators) {
    for (const g of generators) switch (g.generatorType) {
      default:
        this.generators.push(g);
        break;
      case generatorTypes.sampleID:
      case generatorTypes.instrument:
        break;
      case generatorTypes.velRange:
        this.velRange.min = g.generatorValue & 127;
        this.velRange.max = g.generatorValue >> 8 & 127;
        break;
      case generatorTypes.keyRange:
        this.keyRange.min = g.generatorValue & 127;
        this.keyRange.max = g.generatorValue >> 8 & 127;
    }
  }
  /**
  * Adds modulators to the zone.
  * @param modulators the modulators to add.
  */
  addModulators(...modulators) {
    this.modulators.push(...modulators);
  }
  /**
  * Gets a generator value.
  * @param generatorType the generator type.
  * @param notFoundValue if the generator is not found, this value is returned. A default value can be passed here, or null for example,
  * to check if the generator is set.
  */
  getGenerator(generatorType, notFoundValue) {
    return this.generators.find((g) => g.generatorType === generatorType)?.generatorValue ?? notFoundValue;
  }
  copyFrom(zone) {
    this.generators = zone.generators.map((g) => new Generator(g.generatorType, g.generatorValue, false));
    this.modulators = zone.modulators.map(Modulator.copyFrom.bind(Modulator));
    this.velRange = { ...zone.velRange };
    this.keyRange = { ...zone.keyRange };
  }
  /**
  * Filters the generators and prepends the range generators.
  */
  getWriteGenerators(bank) {
    const generators = this.generators.filter((g) => g.generatorType !== generatorTypes.sampleID && g.generatorType !== generatorTypes.instrument && g.generatorType !== generatorTypes.keyRange && g.generatorType !== generatorTypes.velRange);
    if (!bank) throw new Error("No bank provided! ");
    if (this.hasVelRange) generators.unshift(new Generator(generatorTypes.velRange, this.velRange.max << 8 | Math.max(this.velRange.min, 0), false));
    if (this.hasKeyRange) generators.unshift(new Generator(generatorTypes.keyRange, this.keyRange.max << 8 | Math.max(this.keyRange.min, 0), false));
    return generators;
  }
};
var BasicGlobalZone = class extends BasicZone {
};
var RESAMPLE_RATE = 48e3;
var BasicSample = class {
  /**
  * The sample's name.
  */
  name;
  /**
  * Sample rate in Hz.
  */
  sampleRate;
  /**
  * Original pitch of the sample as a MIDI note number.
  */
  originalKey;
  /**
  * Pitch correction, in cents. Can be negative.
  */
  pitchCorrection;
  /**
  * Linked sample, unused if mono.
  */
  linkedSample;
  /**
  * The type of the sample.
  */
  sampleType;
  /**
  * Relative to the start of the sample in sample points.
  */
  loopStart;
  /**
  * Relative to the start of the sample in sample points.
  */
  loopEnd;
  /**
  * Sample's linked instruments (the instruments that use it)
  * note that duplicates are allowed since one instrument can use the same sample multiple times.
  */
  linkedTo = [];
  /**
  * Indicates if the data was overridden, so it cannot be copied back unchanged.
  */
  dataOverridden = true;
  /**
  * The compressed sample data if the sample has been compressed.
  */
  compressedData;
  /**
  * The sample's audio data.
  */
  audioData;
  /**
  * The basic representation of a sample
  * @param sampleName The sample's name
  * @param sampleRate The sample's rate in Hz
  * @param originalKey The sample's pitch as a MIDI note number
  * @param pitchCorrection The sample's pitch correction in cents
  * @param sampleType The sample's type, an enum that can indicate SF3
  * @param loopStart The sample's loop start relative to the sample start in sample points
  * @param loopEnd The sample's loop end relative to the sample start in sample points
  */
  constructor(sampleName, sampleRate, originalKey, pitchCorrection, sampleType, loopStart, loopEnd) {
    this.name = sampleName;
    this.sampleRate = sampleRate;
    this.originalKey = originalKey;
    this.pitchCorrection = pitchCorrection;
    this.loopStart = loopStart;
    this.loopEnd = loopEnd;
    this.sampleType = sampleType;
  }
  /**
  * Indicates if the sample is compressed using vorbis SF3.
  */
  get isCompressed() {
    return this.compressedData !== void 0;
  }
  /**
  * If the sample is linked to another sample.
  */
  get isLinked() {
    return this.sampleType === sampleTypes.rightSample || this.sampleType === sampleTypes.leftSample || this.sampleType === sampleTypes.linkedSample;
  }
  /**
  * The sample's use count
  */
  get useCount() {
    return this.linkedTo.length;
  }
  /**
  * Get raw data for writing the file, either a compressed bit stream or signed 16-bit little endian PCM data.
  * @param allowVorbis if vorbis file data is allowed.
  * @return either s16le or vorbis data.
  */
  getRawData(allowVorbis) {
    if (this.compressedData && allowVorbis && !this.dataOverridden) return this.compressedData;
    return this.encodeS16LE();
  }
  /**
  * Resamples the audio data to a given sample rate.
  */
  resampleData(newSampleRate) {
    let audioData = this.getAudioData();
    const ratio = newSampleRate / this.sampleRate;
    const resampled = new Float32Array(Math.floor(audioData.length * ratio));
    for (let i = 0; i < resampled.length; i++) resampled[i] = audioData[Math.floor(i * (1 / ratio))];
    audioData = resampled;
    this.sampleRate = newSampleRate;
    this.loopStart = Math.floor(this.loopStart * ratio);
    this.loopEnd = Math.floor(this.loopEnd * ratio);
    this.audioData = audioData;
  }
  /**
  * Compresses the audio data
  * @param encodeVorbis the compression function to use when compressing
  */
  async compressSample(encodeVorbis) {
    if (this.isCompressed) return;
    try {
      let audioData = this.getAudioData();
      if (this.sampleRate < 8e3 || this.sampleRate > 96e3) {
        this.resampleData(RESAMPLE_RATE);
        audioData = this.getAudioData();
      }
      const compressed = await encodeVorbis(audioData, this.sampleRate);
      this.setCompressedData(compressed);
    } catch (error) {
      SpessaSynthWarn(`Failed to compress ${this.name}. Leaving as uncompressed!`, error);
      this.compressedData = void 0;
    }
  }
  /**
  * Sets the sample type and unlinks if needed.
  * @param type The type to set it to.
  */
  setSampleType(type) {
    this.sampleType = type;
    if (!this.isLinked) {
      if (this.linkedSample) {
        this.linkedSample.linkedSample = void 0;
        this.linkedSample.sampleType = type;
      }
      this.linkedSample = void 0;
    }
    if ((type & 32768) > 0) throw new Error("ROM samples are not supported.");
  }
  /**
  * Unlinks the sample from its stereo link if it has any.
  */
  unlinkSample() {
    this.setSampleType(sampleTypes.monoSample);
  }
  /**
  * Links a stereo sample.
  * @param sample the sample to link to.
  * @param type either left, right or linked.
  */
  setLinkedSample(sample, type) {
    if (sample.linkedSample) throw new Error(`${sample.name} is linked tp ${sample.linkedSample.name}. Unlink it first.`);
    this.linkedSample = sample;
    sample.linkedSample = this;
    switch (type) {
      case sampleTypes.leftSample:
        this.setSampleType(sampleTypes.leftSample);
        sample.setSampleType(sampleTypes.rightSample);
        break;
      case sampleTypes.rightSample:
        this.setSampleType(sampleTypes.rightSample);
        sample.setSampleType(sampleTypes.leftSample);
        break;
      case sampleTypes.linkedSample:
        this.setSampleType(sampleTypes.linkedSample);
        sample.setSampleType(sampleTypes.linkedSample);
        break;
      default:
        throw new Error("Invalid sample type: " + type);
    }
  }
  /**
  * Links the sample to a given instrument
  * @param instrument the instrument to link to
  */
  linkTo(instrument) {
    this.linkedTo.push(instrument);
  }
  /**
  * Unlinks the sample from a given instrument
  * @param instrument the instrument to unlink from
  */
  unlinkFrom(instrument) {
    const index = this.linkedTo.indexOf(instrument);
    if (index === -1) {
      SpessaSynthWarn(`Cannot unlink ${instrument.name} from ${this.name}: not linked.`);
      return;
    }
    this.linkedTo.splice(index, 1);
  }
  /**
  * Get the float32 audio data.
  * Note that this either decodes the compressed data or passes the ready sampleData.
  * If neither are set then it will throw an error!
  * @returns the audio data
  */
  getAudioData() {
    if (this.audioData) return this.audioData;
    if (this.isCompressed) {
      this.audioData = this.decodeVorbis();
      return this.audioData;
    }
    throw new Error("Sample data is undefined for a BasicSample instance.");
  }
  /**
  * Replaces the audio data *in-place*.
  * @param audioData The new audio data as Float32.
  * @param sampleRate The new sample rate, in Hertz.
  */
  setAudioData(audioData, sampleRate) {
    this.audioData = audioData;
    this.sampleRate = sampleRate;
    this.dataOverridden = true;
    this.compressedData = void 0;
  }
  /**
  * Replaces the audio with a compressed data sample and flags the sample as compressed
  * @param data the new compressed data
  */
  setCompressedData(data) {
    this.audioData = void 0;
    this.compressedData = data;
    this.dataOverridden = false;
  }
  /**
  * Encodes s16le sample
  * @return the encoded data
  */
  encodeS16LE() {
    const data = this.getAudioData();
    const data16 = new Int16Array(data.length);
    const len = data.length;
    for (let i = 0; i < len; i++) {
      let sample = data[i] * 32768;
      if (sample > 32767) sample = 32767;
      else if (sample < -32768) sample = -32768;
      data16[i] = sample;
    }
    return new IndexedByteArray(data16.buffer);
  }
  /**
  * Decode binary vorbis into a float32 pcm
  */
  decodeVorbis() {
    if (this.audioData) return this.audioData;
    if (!this.compressedData) throw new Error("Compressed data is missing.");
    try {
      const decoded = stb.decode(this.compressedData).data[0];
      if (decoded === void 0) {
        SpessaSynthWarn(`Error decoding sample ${this.name}: Vorbis decode returned undefined.`);
        return new Float32Array(0);
      }
      for (let i = 0; i < decoded.length; i++) decoded[i] = Math.max(-1, Math.min(decoded[i], 0.999969482421875));
      return decoded;
    } catch (error) {
      SpessaSynthWarn(`Error decoding sample ${this.name}: ${error}`);
      return new Float32Array(this.loopEnd + 1);
    }
  }
};
var EmptySample = class extends BasicSample {
  /**
  * A simplified class for creating samples.
  */
  constructor() {
    super("", 44100, 60, 0, sampleTypes.monoSample, 0, 0);
  }
};
var BasicInstrumentZone = class extends BasicZone {
  /**
  * The instrument this zone belongs to.
  */
  parentInstrument;
  /**
  * For tracking on the individual zone level, since multiple presets can refer to the same instrument.
  */
  useCount;
  /**
  * Creates a new instrument zone.
  * @param instrument The parent instrument.
  * @param sample The sample to use in this zone.
  */
  constructor(instrument, sample) {
    super();
    this.parentInstrument = instrument;
    this._sample = sample;
    sample.linkTo(this.parentInstrument);
    this.useCount = instrument.useCount;
  }
  /**
  * Zone's sample.
  */
  _sample;
  /**
  * Zone's sample.
  */
  get sample() {
    return this._sample;
  }
  /**
  * Sets a sample for this zone.
  * @param sample the sample to set.
  */
  set sample(sample) {
    if (this._sample) this._sample.unlinkFrom(this.parentInstrument);
    this._sample = sample;
    sample.linkTo(this.parentInstrument);
  }
  getWriteGenerators(bank) {
    const gens = super.getWriteGenerators(bank);
    const sampleID = bank.samples.indexOf(this.sample);
    if (sampleID === -1) throw new Error(`${this.sample.name} does not exist in ${bank.soundBankInfo.name}! Cannot write sampleID generator.`);
    gens.push(new Generator(generatorTypes.sampleID, sampleID, false));
    return gens;
  }
};
var BasicPresetZone = class extends BasicZone {
  /**
  * The preset this zone belongs to.
  */
  parentPreset;
  /**
  * Creates a new preset zone.
  * @param preset the preset this zone belongs to.
  * @param instrument the instrument to use in this zone.
  */
  constructor(preset, instrument) {
    super();
    this.parentPreset = preset;
    this._instrument = instrument;
    this._instrument.linkTo(this.parentPreset);
  }
  /**
  * Zone's instrument.
  */
  _instrument;
  /**
  * Zone's instrument.
  */
  get instrument() {
    return this._instrument;
  }
  /**
  * Zone's instrument.
  */
  set instrument(instrument) {
    if (this._instrument) this._instrument.unlinkFrom(this.parentPreset);
    this._instrument = instrument;
    this._instrument.linkTo(this.parentPreset);
  }
  getWriteGenerators(bank) {
    const gens = super.getWriteGenerators(bank);
    if (!bank) throw new Error("Instrument ID cannot be determined without the sound bank itself.");
    const instrumentID = bank.instruments.indexOf(this.instrument);
    if (instrumentID === -1) throw new Error(`${this.instrument.name} does not exist in ${bank.soundBankInfo.name}! Cannot write instrument generator.`);
    gens.push(new Generator(generatorTypes.instrument, instrumentID, false));
    return gens;
  }
};
var BasicPreset = class BasicPreset2 {
  /**
  * The parent soundbank instance
  * Currently used for determining default modulators and XG status
  */
  parentSoundBank;
  /**
  * The preset's name
  */
  name = "";
  program = 0;
  bankMSB = 0;
  bankLSB = 0;
  isGMGSDrum = false;
  /**
  * The preset's zones
  */
  zones = [];
  /**
  * Preset's global zone
  */
  globalZone;
  /**
  * Unused metadata
  */
  library = 0;
  /**
  * Unused metadata
  */
  genre = 0;
  /**
  * Unused metadata
  */
  morphology = 0;
  /**
  * Creates a new preset representation.
  * @param parentSoundBank the sound bank this preset belongs to.
  * @param globalZone optional, a global zone to use.
  */
  constructor(parentSoundBank, globalZone = new BasicGlobalZone()) {
    this.parentSoundBank = parentSoundBank;
    this.globalZone = globalZone;
  }
  get isXGDrums() {
    return this.parentSoundBank.isXGBank && BankSelectHacks.isXGDrums(this.bankMSB);
  }
  /**
  * Checks if this preset is a drum preset
  */
  get isAnyDrums() {
    const xg = this.parentSoundBank.isXGBank;
    return this.isGMGSDrum || xg && BankSelectHacks.isXGDrums(this.bankMSB);
  }
  static isInRange(range, number) {
    return number >= range.min && number <= range.max;
  }
  static addUniqueModulators(main, adder) {
    for (const addedMod of adder) if (!main.some((mm) => Modulator.isIdentical(addedMod, mm))) main.push(addedMod);
  }
  static subtractRanges(r1, r2) {
    return {
      min: Math.max(r1.min, r2.min),
      max: Math.min(r1.max, r2.max)
    };
  }
  /**
  * Unlinks everything from this preset.
  */
  delete() {
    for (const z of this.zones) z.instrument?.unlinkFrom(this);
  }
  /**
  * Deletes an instrument zone from this preset.
  * @param index the zone's index to delete.
  */
  deleteZone(index) {
    this.zones[index]?.instrument?.unlinkFrom(this);
    this.zones.splice(index, 1);
  }
  /**
  * Creates a new preset zone and returns it.
  * @param instrument the instrument to use in the zone.
  */
  createZone(instrument) {
    const z = new BasicPresetZone(this, instrument);
    this.zones.push(z);
    return z;
  }
  /**
  * Preloads (loads and caches synthesis data) for a given key range.
  */
  preload(keyMin, keyMax) {
    for (let key = keyMin; key < keyMax + 1; key++) for (let velocity = 0; velocity < 128; velocity++) for (const synthesisData of this.getVoiceParameters(key, velocity)) synthesisData.sample.getAudioData();
  }
  /**
  * Checks if the bank and program numbers are the same for the given preset as this one.
  * @param preset The preset to check.
  */
  matches(preset) {
    return MIDIPatchTools.matches(this, preset);
  }
  /**
  * Returns the voice synthesis data for this preset.
  * @param midiNote the MIDI note number.
  * @param velocity the MIDI velocity.
  * @returns the returned sound data.
  */
  getVoiceParameters(midiNote, velocity) {
    const voiceParameters = new Array();
    for (const presetZone of this.zones) {
      if (!BasicPreset2.isInRange(presetZone.hasKeyRange ? presetZone.keyRange : this.globalZone.keyRange, midiNote) || !BasicPreset2.isInRange(presetZone.hasVelRange ? presetZone.velRange : this.globalZone.velRange, velocity)) continue;
      const instrument = presetZone.instrument;
      if (!instrument || instrument.zones.length === 0) continue;
      const presetGenerators = new Int16Array(GENERATORS_AMOUNT);
      for (const generator of this.globalZone.generators) presetGenerators[generator.generatorType] = generator.generatorValue;
      for (const generator of presetZone.generators) presetGenerators[generator.generatorType] = generator.generatorValue;
      const presetModulators = [...presetZone.modulators];
      BasicPreset2.addUniqueModulators(presetModulators, this.globalZone.modulators);
      for (const instZone of instrument.zones) {
        if (!BasicPreset2.isInRange(instZone.hasKeyRange ? instZone.keyRange : instrument.globalZone.keyRange, midiNote) || !BasicPreset2.isInRange(instZone.hasVelRange ? instZone.velRange : instrument.globalZone.velRange, velocity)) continue;
        const modulators = [...instZone.modulators];
        BasicPreset2.addUniqueModulators(modulators, instrument.globalZone.modulators);
        BasicPreset2.addUniqueModulators(modulators, this.parentSoundBank.defaultModulators);
        for (const presetMod of presetModulators) {
          const matchIndex = modulators.findIndex((m) => Modulator.isIdentical(presetMod, m));
          if (matchIndex === -1) modulators.push(presetMod);
          else modulators[matchIndex] = modulators[matchIndex].sumTransform(presetMod);
        }
        const generators = new Int16Array(defaultGeneratorValues);
        for (const generator of instrument.globalZone.generators) generators[generator.generatorType] = generator.generatorValue;
        for (const generator of instZone.generators) generators[generator.generatorType] = generator.generatorValue;
        for (let i = 0; i < generators.length; i++) generators[i] = Math.max(-32768, Math.min(32767, generators[i] + presetGenerators[i]));
        generators[generatorTypes.initialAttenuation] = Math.floor(generators[generatorTypes.initialAttenuation] * 0.4);
        voiceParameters.push({
          sample: instZone.sample,
          generators,
          modulators
        });
      }
    }
    return voiceParameters;
  }
  /**
  * BankMSB:bankLSB:program:isGMGSDrum
  */
  toMIDIString() {
    return MIDIPatchTools.toMIDIString(this);
  }
  toString() {
    return MIDIPatchTools.toNamedMIDIString(this);
  }
  /**
  * Combines preset into an instrument, flattening the preset zones into instrument zones.
  * This is a really complex function that attempts to work around the DLS limitations of only having the instrument layer.
  * @returns The instrument containing the flattened zones. In theory, it should exactly the same as this preset.
  */
  toFlattenedInstrument() {
    const addUnique = (main, adder) => {
      main.push(...adder.filter((g) => !main.some((mg) => mg.generatorType === g.generatorType)));
    };
    const addUniqueMods = (main, adder) => {
      main.push(...adder.filter((m) => !main.some((mm) => Modulator.isIdentical(m, mm))));
    };
    const outputInstrument = new BasicInstrument();
    outputInstrument.name = this.name;
    const globalPresetGenerators = [];
    const globalPresetModulators = [];
    const globalPresetZone = this.globalZone;
    globalPresetGenerators.push(...globalPresetZone.generators);
    globalPresetModulators.push(...globalPresetZone.modulators);
    const globalPresetKeyRange = globalPresetZone.keyRange;
    const globalPresetVelRange = globalPresetZone.velRange;
    for (const presetZone of this.zones) {
      if (!presetZone.instrument) throw new Error("No instrument in a preset zone.");
      let presetZoneKeyRange = presetZone.keyRange;
      if (!presetZone.hasKeyRange) presetZoneKeyRange = globalPresetKeyRange;
      let presetZoneVelRange = presetZone.velRange;
      if (!presetZone.hasVelRange) presetZoneVelRange = globalPresetVelRange;
      const presetGenerators = presetZone.generators.map((g) => new Generator(g.generatorType, g.generatorValue));
      addUnique(presetGenerators, globalPresetGenerators);
      const presetModulators = [...presetZone.modulators];
      addUniqueMods(presetModulators, globalPresetModulators);
      const instrument = presetZone.instrument;
      const iZones = instrument.zones;
      const globalInstGenerators = [];
      const globalInstModulators = [];
      const globalInstZone = instrument.globalZone;
      globalInstGenerators.push(...globalInstZone.generators);
      globalInstModulators.push(...globalInstZone.modulators);
      const globalInstKeyRange = globalInstZone.keyRange;
      const globalInstVelRange = globalInstZone.velRange;
      for (const instZone of iZones) {
        if (!instZone.sample) throw new Error("No sample in an instrument zone.");
        let instZoneKeyRange = instZone.keyRange;
        if (!instZone.hasKeyRange) instZoneKeyRange = globalInstKeyRange;
        let instZoneVelRange = instZone.velRange;
        if (!instZone.hasVelRange) instZoneVelRange = globalInstVelRange;
        instZoneKeyRange = BasicPreset2.subtractRanges(instZoneKeyRange, presetZoneKeyRange);
        instZoneVelRange = BasicPreset2.subtractRanges(instZoneVelRange, presetZoneVelRange);
        if (instZoneKeyRange.max < instZoneKeyRange.min || instZoneVelRange.max < instZoneVelRange.min) continue;
        const instGenerators = instZone.generators.map((g) => new Generator(g.generatorType, g.generatorValue));
        addUnique(instGenerators, globalInstGenerators);
        const instModulators = [...instZone.modulators];
        addUniqueMods(instModulators, globalInstModulators);
        const finalModList = [...instModulators];
        for (const mod of presetModulators) {
          const identicalInstMod = finalModList.findIndex((m) => Modulator.isIdentical(mod, m));
          if (identicalInstMod === -1) finalModList.push(mod);
          else finalModList[identicalInstMod] = finalModList[identicalInstMod].sumTransform(mod);
        }
        let finalGenList = instGenerators.map((g) => new Generator(g.generatorType, g.generatorValue));
        for (const gen of presetGenerators) {
          if (gen.generatorType === generatorTypes.velRange || gen.generatorType === generatorTypes.keyRange || gen.generatorType === generatorTypes.instrument || gen.generatorType === generatorTypes.endOper || gen.generatorType === generatorTypes.sampleModes) continue;
          const identicalInstGen = instGenerators.findIndex((g) => g.generatorType === gen.generatorType);
          if (identicalInstGen === -1) {
            const newAmount = generatorLimits[gen.generatorType].def + gen.generatorValue;
            finalGenList.push(new Generator(gen.generatorType, newAmount));
          } else {
            const newAmount = finalGenList[identicalInstGen].generatorValue + gen.generatorValue;
            finalGenList[identicalInstGen] = new Generator(gen.generatorType, newAmount);
          }
        }
        finalGenList = finalGenList.filter((g) => g.generatorType !== generatorTypes.sampleID && g.generatorType !== generatorTypes.keyRange && g.generatorType !== generatorTypes.velRange && g.generatorType !== generatorTypes.endOper && g.generatorType !== generatorTypes.instrument && g.generatorValue !== generatorLimits[g.generatorType].def);
        const zone = outputInstrument.createZone(instZone.sample);
        zone.keyRange = instZoneKeyRange;
        zone.velRange = instZoneVelRange;
        if (zone.keyRange.min === 0 && zone.keyRange.max === 127) zone.keyRange.min = -1;
        if (zone.velRange.min === 0 && zone.velRange.max === 127) zone.velRange.min = -1;
        zone.addGenerators(...finalGenList);
        zone.addModulators(...finalModList);
      }
    }
    return outputInstrument;
  }
  /**
  * Writes the SF2 header
  * @param phdrData
  * @param index
  */
  write(phdrData, index) {
    SpessaSynthInfo(`%cWriting ${this.name}...`, consoleColors.info);
    writeBinaryStringIndexed(phdrData.pdta, this.name.slice(0, 20), 20);
    writeBinaryStringIndexed(phdrData.xdta, this.name.slice(20), 20);
    writeWord(phdrData.pdta, this.program);
    let wBank = this.bankMSB;
    if (this.isGMGSDrum) wBank = 128;
    else if (this.bankMSB === 0) wBank = this.bankLSB;
    writeWord(phdrData.pdta, wBank);
    phdrData.xdta.currentIndex += 4;
    writeWord(phdrData.pdta, index & 65535);
    writeWord(phdrData.xdta, index >> 16);
    writeDword(phdrData.pdta, this.library);
    writeDword(phdrData.pdta, this.genre);
    writeDword(phdrData.pdta, this.morphology);
    phdrData.xdta.currentIndex += 12;
  }
};
var notGlobalizedTypes = /* @__PURE__ */ new Set([
  generatorTypes.velRange,
  generatorTypes.keyRange,
  generatorTypes.instrument,
  generatorTypes.sampleID,
  generatorTypes.exclusiveClass,
  generatorTypes.endOper,
  generatorTypes.sampleModes,
  generatorTypes.startloopAddrsOffset,
  generatorTypes.startloopAddrsCoarseOffset,
  generatorTypes.endloopAddrsOffset,
  generatorTypes.endloopAddrsCoarseOffset,
  generatorTypes.startAddrsOffset,
  generatorTypes.startAddrsCoarseOffset,
  generatorTypes.endAddrOffset,
  generatorTypes.endAddrsCoarseOffset,
  generatorTypes.initialAttenuation,
  generatorTypes.fineTune,
  generatorTypes.coarseTune,
  generatorTypes.keyNumToVolEnvHold,
  generatorTypes.keyNumToVolEnvDecay,
  generatorTypes.keyNumToModEnvHold,
  generatorTypes.keyNumToModEnvDecay
]);
var BasicInstrument = class {
  /**
  * The instrument's name
  */
  name = "";
  /**
  * The instrument's zones
  */
  zones = [];
  /**
  * Instrument's global zone
  */
  globalZone = new BasicGlobalZone();
  /**
  * Instrument's linked presets (the presets that use it)
  * note that duplicates are allowed since one preset can use the same instrument multiple times.
  */
  linkedTo = [];
  /**
  * How many presets is this instrument used by
  */
  get useCount() {
    return this.linkedTo.length;
  }
  /**
  * Creates a new instrument zone and returns it.
  * @param sample The sample to use in the zone.
  */
  createZone(sample) {
    const zone = new BasicInstrumentZone(this, sample);
    this.zones.push(zone);
    return zone;
  }
  /**
  * Links the instrument ta a given preset
  * @param preset the preset to link to
  */
  linkTo(preset) {
    this.linkedTo.push(preset);
    for (const z of this.zones) z.useCount++;
  }
  /**
  * Unlinks the instrument from a given preset
  * @param preset the preset to unlink from
  */
  unlinkFrom(preset) {
    const index = this.linkedTo.indexOf(preset);
    if (index === -1) {
      SpessaSynthWarn(`Cannot unlink ${preset.name} from ${this.name}: not linked.`);
      return;
    }
    this.linkedTo.splice(index, 1);
    for (const z of this.zones) z.useCount--;
  }
  deleteUnusedZones() {
    this.zones = this.zones.filter((z) => {
      const stays = z.useCount > 0;
      if (!stays) z.sample.unlinkFrom(this);
      return stays;
    });
  }
  delete() {
    if (this.useCount > 0) throw new Error(`Cannot delete an instrument that is used by: ${this.linkedTo.map((p) => p.name).toString()}.`);
    for (const z of this.zones) z.sample.unlinkFrom(this);
  }
  /**
  * Deletes a given instrument zone if it has no uses
  * @param index the index of the zone to delete
  * @param force ignores the use count and deletes forcibly
  * @returns if the zone has been deleted
  */
  deleteZone(index, force = false) {
    const zone = this.zones[index];
    zone.useCount -= 1;
    if (zone.useCount < 1 || force) {
      zone.sample.unlinkFrom(this);
      this.zones.splice(index, 1);
      return true;
    }
    return false;
  }
  /**
  * Globalizes the instrument *in-place.*
  * This means trying to move as many generators and modulators
  * to the global zone as possible to reduce clutter and the count of parameters.
  */
  globalize() {
    const globalZone = this.globalZone;
    for (let checkedType = 0; checkedType < 58; checkedType++) {
      if (notGlobalizedTypes.has(checkedType)) continue;
      checkedType = checkedType;
      let occurrencesForValues = {};
      const defaultForChecked = generatorLimits[checkedType]?.def || 0;
      occurrencesForValues[defaultForChecked] = 0;
      for (const zone of this.zones) {
        const value = zone.getGenerator(checkedType, void 0);
        if (value === void 0) occurrencesForValues[defaultForChecked]++;
        else if (occurrencesForValues[value] === void 0) occurrencesForValues[value] = 1;
        else occurrencesForValues[value]++;
        let relativeCounterpart;
        switch (checkedType) {
          default:
            continue;
          case generatorTypes.decayVolEnv:
            relativeCounterpart = generatorTypes.keyNumToVolEnvDecay;
            break;
          case generatorTypes.holdVolEnv:
            relativeCounterpart = generatorTypes.keyNumToVolEnvHold;
            break;
          case generatorTypes.decayModEnv:
            relativeCounterpart = generatorTypes.keyNumToModEnvDecay;
            break;
          case generatorTypes.holdModEnv:
            relativeCounterpart = generatorTypes.keyNumToModEnvHold;
        }
        if (zone.getGenerator(relativeCounterpart, void 0) !== void 0) {
          occurrencesForValues = {};
          break;
        }
      }
      if (Object.keys(occurrencesForValues).length > 0) {
        let valueToGlobalize = ["0", 0];
        for (const [value, count] of Object.entries(occurrencesForValues)) if (count > valueToGlobalize[1]) valueToGlobalize = [value, count];
        const targetValue = Number.parseInt(valueToGlobalize[0]);
        if (targetValue !== defaultForChecked) globalZone.setGenerator(checkedType, targetValue, false);
        for (const z of this.zones) {
          const genValue = z.getGenerator(checkedType, void 0);
          if (genValue === void 0) {
            if (targetValue !== defaultForChecked) z.setGenerator(checkedType, defaultForChecked);
          } else if (genValue === targetValue) z.setGenerator(checkedType, null);
        }
      }
    }
    const modulators = this.zones[0].modulators.map((m) => Modulator.copyFrom(m));
    for (const checkedModulator of modulators) {
      let existsForAllZones = true;
      for (const zone of this.zones) {
        if (!existsForAllZones) continue;
        if (!zone.modulators.find((m) => Modulator.isIdentical(m, checkedModulator))) existsForAllZones = false;
      }
      if (existsForAllZones) {
        globalZone.addModulators(Modulator.copyFrom(checkedModulator));
        for (const zone of this.zones) {
          const modulator = zone.modulators.find((m) => Modulator.isIdentical(m, checkedModulator));
          if (!modulator) continue;
          if (modulator.transformAmount === checkedModulator.transformAmount) zone.modulators.splice(zone.modulators.indexOf(modulator), 1);
        }
      }
    }
  }
  write(instData, index) {
    SpessaSynthInfo(`%cWriting ${this.name}...`, consoleColors.info);
    writeBinaryStringIndexed(instData.pdta, this.name.slice(0, 20), 20);
    writeBinaryStringIndexed(instData.xdta, this.name.slice(20), 20);
    writeWord(instData.pdta, index & 65535);
    writeWord(instData.xdta, index >>> 16);
  }
};
var SDTA_TO_DATA_OFFSET = 20;
async function getSDTA(bank, smplStartOffsets, smplEndOffsets, compress, decompress, vorbisFunc, progressFunc) {
  let writtenCount = 0;
  let smplChunkSize = 0;
  const sampleDatas = [];
  for (const s of bank.samples) {
    if (compress && vorbisFunc) await s.compressSample(vorbisFunc);
    if (decompress) s.setAudioData(s.getAudioData(), s.sampleRate);
    const r = s.getRawData(true);
    writtenCount++;
    await progressFunc?.(s.name, writtenCount, bank.samples.length);
    SpessaSynthInfo(`%cEncoded sample %c${writtenCount}. ${s.name}%c of %c${bank.samples.length}%c. Compressed: %c${s.isCompressed}%c.`, consoleColors.info, consoleColors.recognized, consoleColors.info, consoleColors.recognized, consoleColors.info, s.isCompressed ? consoleColors.recognized : consoleColors.unrecognized, consoleColors.info);
    smplChunkSize += r.length + (s.isCompressed ? 0 : 92);
    sampleDatas.push(r);
  }
  if (smplChunkSize % 2 !== 0) smplChunkSize++;
  const sdta = new IndexedByteArray(smplChunkSize + SDTA_TO_DATA_OFFSET);
  writeBinaryStringIndexed(sdta, "LIST");
  writeLittleEndianIndexed(sdta, smplChunkSize + SDTA_TO_DATA_OFFSET - 8, 4);
  writeBinaryStringIndexed(sdta, "sdta");
  writeBinaryStringIndexed(sdta, "smpl");
  writeLittleEndianIndexed(sdta, smplChunkSize, 4);
  let offset = 0;
  for (const [i, sample] of bank.samples.entries()) {
    const data = sampleDatas[i];
    sdta.set(data, offset + SDTA_TO_DATA_OFFSET);
    let startOffset;
    let endOffset;
    if (sample.isCompressed) {
      startOffset = offset;
      endOffset = startOffset + data.length;
    } else {
      startOffset = offset / 2;
      endOffset = startOffset + data.length / 2;
      offset += 92;
    }
    offset += data.length;
    smplStartOffsets.push(startOffset);
    smplEndOffsets.push(endOffset);
  }
  return sdta;
}
function getSHDR(bank, smplStartOffsets, smplEndOffsets) {
  const sampleLength = 46;
  const shdrSize = sampleLength * (bank.samples.length + 1);
  const shdrData = new IndexedByteArray(shdrSize);
  const xshdrData = new IndexedByteArray(shdrSize);
  let maxSampleLink = 0;
  for (const [index, sample] of bank.samples.entries()) {
    writeBinaryStringIndexed(shdrData, sample.name.slice(0, 20), 20);
    writeBinaryStringIndexed(xshdrData, sample.name.slice(20), 20);
    const dwStart = smplStartOffsets[index];
    writeDword(shdrData, dwStart);
    xshdrData.currentIndex += 4;
    const dwEnd = smplEndOffsets[index];
    writeDword(shdrData, dwEnd);
    xshdrData.currentIndex += 4;
    let loopStart = sample.loopStart + dwStart;
    let loopEnd = sample.loopEnd + dwStart;
    if (sample.isCompressed) {
      loopStart -= dwStart;
      loopEnd -= dwStart;
    }
    writeDword(shdrData, loopStart);
    writeDword(shdrData, loopEnd);
    writeDword(shdrData, sample.sampleRate);
    shdrData[shdrData.currentIndex++] = sample.originalKey;
    shdrData[shdrData.currentIndex++] = sample.pitchCorrection;
    xshdrData.currentIndex += 14;
    const sampleLinkIndex = sample.linkedSample ? bank.samples.indexOf(sample.linkedSample) : 0;
    writeWord(shdrData, Math.max(0, sampleLinkIndex) & 65535);
    writeWord(xshdrData, Math.max(0, sampleLinkIndex) >> 16);
    maxSampleLink = Math.max(maxSampleLink, sampleLinkIndex);
    let type = sample.sampleType;
    if (sample.isCompressed) type |= 16;
    writeWord(shdrData, type);
    xshdrData.currentIndex += 2;
  }
  writeBinaryStringIndexed(shdrData, "EOS", sampleLength);
  writeBinaryStringIndexed(xshdrData, "EOS", sampleLength);
  return {
    pdta: RIFFChunk.write("shdr", shdrData),
    xdta: RIFFChunk.write("shdr", xshdrData)
  };
}
function writeSF2Elements(bank, isPreset = false) {
  const elements = isPreset ? bank.presets : bank.instruments;
  const genHeader = isPreset ? "pgen" : "igen";
  const modHeader = isPreset ? "pmod" : "imod";
  const bagHeader = isPreset ? "pbag" : "ibag";
  const hdrHeader = isPreset ? "phdr" : "inst";
  const hdrByteSize = isPreset ? 38 : 22;
  let currentGenIndex = 0;
  const generatorIndexes = new Array();
  let currentModIndex = 0;
  const modulatorIndexes = new Array();
  const generators = new Array();
  const modulators = new Array();
  let zoneIndex = 0;
  const zoneIndexes = new Array();
  const writeZone = (z) => {
    generatorIndexes.push(currentGenIndex);
    const gens = z.getWriteGenerators(bank);
    currentGenIndex += gens.length;
    generators.push(...gens);
    modulatorIndexes.push(currentModIndex);
    const mods = z.modulators;
    currentModIndex += mods.length;
    modulators.push(...mods);
  };
  for (const el of elements) {
    zoneIndexes.push(zoneIndex);
    writeZone(el.globalZone);
    for (const zone of el.zones) writeZone(zone);
    zoneIndex += el.zones.length + 1;
  }
  generators.push(new Generator(0, 0, false));
  modulators.push(new DecodedModulator(0, 0, 0, 0, 0));
  generatorIndexes.push(currentGenIndex);
  modulatorIndexes.push(currentModIndex);
  zoneIndexes.push(zoneIndex);
  const genData = new IndexedByteArray(generators.length * 4);
  for (const g of generators) g.write(genData);
  const modData = new IndexedByteArray(modulators.length * 10);
  for (const m of modulators) m.write(modData);
  const bagSize = modulatorIndexes.length * 4;
  const bagData = {
    pdta: new IndexedByteArray(bagSize),
    xdta: new IndexedByteArray(bagSize)
  };
  for (const [i, modulatorIndex] of modulatorIndexes.entries()) {
    const generatorIndex = generatorIndexes[i];
    writeWord(bagData.pdta, generatorIndex & 65535);
    writeWord(bagData.pdta, modulatorIndex & 65535);
    writeWord(bagData.xdta, generatorIndex >> 16);
    writeWord(bagData.xdta, modulatorIndex >> 16);
  }
  const hdrSize = (elements.length + 1) * hdrByteSize;
  const hdrData = {
    pdta: new IndexedByteArray(hdrSize),
    xdta: new IndexedByteArray(hdrSize)
  };
  for (const [i, el] of elements.entries()) el.write(hdrData, zoneIndexes[i]);
  if (isPreset) {
    writeBinaryStringIndexed(hdrData.pdta, "EOP", 20);
    hdrData.pdta.currentIndex += 4;
    writeWord(hdrData.pdta, zoneIndex & 65535);
    hdrData.pdta.currentIndex += 12;
    writeBinaryStringIndexed(hdrData.xdta, "", 20);
    hdrData.xdta.currentIndex += 4;
    writeWord(hdrData.xdta, zoneIndex >> 16);
    hdrData.xdta.currentIndex += 12;
  } else {
    writeBinaryStringIndexed(hdrData.pdta, "EOI", 20);
    writeWord(hdrData.pdta, zoneIndex & 65535);
    writeBinaryStringIndexed(hdrData.xdta, "", 20);
    writeWord(hdrData.xdta, zoneIndex >> 16);
  }
  return {
    writeXdta: Math.max(currentGenIndex, currentModIndex, zoneIndex) > 65535,
    gen: {
      pdta: RIFFChunk.write(genHeader, genData),
      xdta: RIFFChunk.write(modHeader, new IndexedByteArray(4))
    },
    mod: {
      pdta: RIFFChunk.write(modHeader, modData),
      xdta: RIFFChunk.write(modHeader, new IndexedByteArray(10))
    },
    bag: {
      pdta: RIFFChunk.write(bagHeader, bagData.pdta),
      xdta: RIFFChunk.write(bagHeader, bagData.xdta)
    },
    hdr: {
      pdta: RIFFChunk.write(hdrHeader, hdrData.pdta),
      xdta: RIFFChunk.write(hdrHeader, hdrData.xdta)
    }
  };
}
var DEFAULT_SF2_WRITE_OPTIONS = {
  compress: false,
  writeDefaultModulators: true,
  writeExtendedLimits: true,
  decompress: false
};
async function writeSF2Internal(bank, writeOptions = DEFAULT_SF2_WRITE_OPTIONS) {
  const options = fillWithDefaults(writeOptions, DEFAULT_SF2_WRITE_OPTIONS);
  if (options?.compress) {
    if (typeof options?.compressionFunction !== "function") throw new TypeError("No compression function supplied but compression enabled.");
    if (options?.decompress) throw new Error("Decompressed and compressed at the same time.");
  }
  SpessaSynthGroupCollapsed("%cSaving soundbank...", consoleColors.info);
  SpessaSynthInfo(`%cCompression: %c${options?.compress || "false"}%c`, consoleColors.info, consoleColors.recognized, consoleColors.info, consoleColors.recognized);
  SpessaSynthGroup("%cWriting INFO...", consoleColors.info);
  const infoArrays = [];
  const info = bank.soundBankInfo;
  if (options?.compress || bank.samples.some((s) => s.isCompressed)) {
    info.version.major = 3;
    info.version.minor = 0;
  }
  if (options?.decompress) {
    info.version.major = 2;
    info.version.minor = 4;
  }
  const writeSF2Info = (type, data) => {
    if (!data) return;
    infoArrays.push(RIFFChunk.write(type, getStringBytes(data, true, true)));
  };
  {
    const ifilData = new IndexedByteArray(4);
    writeWord(ifilData, info.version.major);
    writeWord(ifilData, info.version.minor);
    infoArrays.push(RIFFChunk.write("ifil", ifilData));
  }
  writeSF2Info("isng", info.soundEngine);
  writeSF2Info("INAM", info.name);
  writeSF2Info("irom", info.romInfo);
  if (info.romVersion) {
    const ifilData = new IndexedByteArray(4);
    writeWord(ifilData, info.romVersion.major);
    writeWord(ifilData, info.romVersion.minor);
    infoArrays.push(RIFFChunk.write("iver", ifilData));
  }
  writeSF2Info("ICRD", toISODateString(info.creationDate));
  writeSF2Info("IENG", info.engineer);
  writeSF2Info("IPRD", info.product);
  writeSF2Info("ICOP", info.copyright);
  writeSF2Info("ICMT", info?.subject ? (info?.comment ? info.comment + "\n" : "") + info.subject : info?.comment);
  writeSF2Info("ISFT", options.software ?? "SpessaSynth");
  if (bank.defaultModulators.some((mod) => !SPESSASYNTH_DEFAULT_MODULATORS.some((m) => Modulator.isIdentical(m, mod, true))) && options?.writeDefaultModulators) {
    const mods = bank.defaultModulators;
    SpessaSynthInfo(`%cWriting %c${mods.length}%c default modulators...`, consoleColors.info, consoleColors.recognized, consoleColors.info);
    const dmodData = new IndexedByteArray(10 + mods.length * 10);
    for (const mod of mods) mod.write(dmodData);
    writeLittleEndianIndexed(dmodData, 0, 10);
    infoArrays.push(RIFFChunk.write("DMOD", dmodData));
  }
  SpessaSynthGroupEnd();
  SpessaSynthInfo("%cWriting SDTA...", consoleColors.info);
  const smplStartOffsets = [];
  const smplEndOffsets = [];
  const sdtaChunk = await getSDTA(bank, smplStartOffsets, smplEndOffsets, options.compress, options.decompress, options?.compressionFunction, options?.progressFunction);
  SpessaSynthInfo("%cWriting PDTA...", consoleColors.info);
  SpessaSynthInfo("%cWriting SHDR...", consoleColors.info);
  const shdrChunk = getSHDR(bank, smplStartOffsets, smplEndOffsets);
  SpessaSynthGroup("%cWriting instruments...", consoleColors.info);
  const instData = writeSF2Elements(bank, false);
  SpessaSynthGroupEnd();
  SpessaSynthGroup("%cWriting presets...", consoleColors.info);
  const presData = writeSF2Elements(bank, true);
  SpessaSynthGroupEnd();
  const chunks = [
    presData.hdr,
    presData.bag,
    presData.mod,
    presData.gen,
    instData.hdr,
    instData.bag,
    instData.mod,
    instData.gen,
    shdrChunk
  ];
  const pdtaChunk = RIFFChunk.writeParts("pdta", chunks.map((c) => c.pdta), true);
  if (options.writeExtendedLimits && (instData.writeXdta || presData.writeXdta || bank.presets.some((p) => p.name.length > 20) || bank.instruments.some((i) => i.name.length > 20) || bank.samples.some((s) => s.name.length > 20))) {
    SpessaSynthInfo(`%cWriting the xdta chunk as writeExtendedLimits is enabled and at least one condition was met.`, consoleColors.info, consoleColors.value);
    infoArrays.push(RIFFChunk.writeParts("xdta", chunks.map((c) => c.xdta), true));
  }
  const infoChunk = RIFFChunk.writeParts("INFO", infoArrays, true);
  SpessaSynthInfo("%cWriting the output file...", consoleColors.info);
  const main = RIFFChunk.writeParts("RIFF", [
    getStringBytes("sfbk"),
    infoChunk,
    sdtaChunk,
    pdtaChunk
  ]);
  SpessaSynthInfo(`%cSaved successfully! Final file size: %c${main.length}`, consoleColors.info, consoleColors.recognized);
  SpessaSynthGroupEnd();
  return main.buffer;
}
function getAnyDrums(presets, preferXG) {
  const p = preferXG ? presets.find((p2) => p2.isXGDrums) : presets.find((p2) => p2.isGMGSDrum);
  if (p) return p;
  return presets.find((p2) => p2.isAnyDrums) ?? presets[0];
}
function selectPreset(presets, patch, system) {
  if (presets.length === 0) throw new Error("No presets!");
  if (patch.isGMGSDrum && BankSelectHacks.isSystemXG(system)) patch = {
    ...patch,
    isGMGSDrum: false,
    bankLSB: 0,
    bankMSB: BankSelectHacks.getDrumBank(system)
  };
  const { isGMGSDrum, bankLSB, bankMSB, program } = patch;
  const isXG = BankSelectHacks.isSystemXG(system);
  const xgDrums = BankSelectHacks.isXGDrums(bankMSB) && isXG;
  let p = presets.find((p2) => p2.matches(patch));
  if (p && (!xgDrums || xgDrums && p.isXGDrums)) return p;
  const returnReplacement = (pres) => {
    SpessaSynthInfo(`%cPreset %c${MIDIPatchTools.toMIDIString(patch)}%c not found. (${system}) Replaced with %c${pres.toString()}`, consoleColors.warn, consoleColors.unrecognized, consoleColors.warn, consoleColors.value);
  };
  if (isGMGSDrum) {
    let p2 = presets.find((p3) => p3.isGMGSDrum && p3.program === program);
    if (p2) {
      returnReplacement(p2);
      return p2;
    }
    p2 = presets.find((p3) => p3.isAnyDrums && p3.program === program);
    if (p2) {
      returnReplacement(p2);
      return p2;
    }
    p2 = getAnyDrums(presets, false);
    returnReplacement(p2);
    return p2;
  }
  if (xgDrums) {
    let p2 = presets.find((p3) => p3.program === program && p3.isXGDrums);
    if (p2) {
      returnReplacement(p2);
      return p2;
    }
    p2 = presets.find((p3) => p3.isAnyDrums && p3.program === program);
    if (p2) {
      returnReplacement(p2);
      return p2;
    }
    p2 = getAnyDrums(presets, true);
    returnReplacement(p2);
    return p2;
  }
  const matchingPrograms = presets.filter((p2) => p2.program === program && !p2.isAnyDrums);
  if (matchingPrograms.length === 0) {
    returnReplacement(presets[0]);
    return presets[0];
  }
  p = isXG ? matchingPrograms.find((p2) => p2.bankLSB === bankLSB) : matchingPrograms.find((p2) => p2.bankMSB === bankMSB);
  if (p) {
    returnReplacement(p);
    return p;
  }
  if (bankLSB !== 64 || !isXG) {
    const bank = Math.max(bankMSB, bankLSB);
    p = matchingPrograms.find((p2) => p2.bankLSB === bank || p2.bankMSB === bank);
    if (p) {
      returnReplacement(p);
      return p;
    }
  }
  returnReplacement(matchingPrograms[0]);
  return matchingPrograms[0];
}
var DLSVerifier = class {
  /**
  * @param chunk
  * @param expected
  * @throws error if the check doesn't pass
  */
  static verifyHeader(chunk, ...expected) {
    for (const expect of expected) if (chunk.header.toLowerCase() === expect.toLowerCase()) return;
    this.parsingError(`Invalid DLS chunk header! Expected "${expected.join(", or ")}" got "${chunk.header.toLowerCase()}"`);
  }
  /**
  * @param text {string}
  * @param expected {string}
  * @throws error if the check doesn't pass
  */
  static verifyText(text, ...expected) {
    for (const expect of expected) if (text.toLowerCase() === expect.toLowerCase()) return;
    this.parsingError(`FourCC error: Expected "${expected.join(", or ")}" got "${text.toLowerCase()}"`);
  }
  /**
  * @throws error if the check doesn't pass
  */
  static parsingError(error) {
    SpessaSynthGroupEnd();
    throw new Error(`DLS parse error: ${error} The file may be corrupted.`);
  }
  static verifyAndReadList(chunk, ...type) {
    this.verifyHeader(chunk, "LIST");
    chunk.data.currentIndex = 0;
    this.verifyText(readBinaryStringIndexed(chunk.data, 4), ...type);
    const chunks = [];
    while (chunk.data.length > chunk.data.currentIndex) chunks.push(RIFFChunk.read(chunk.data));
    return chunks;
  }
};
var WSMP_SIZE = 20;
var WSMP_LOOP_SIZE = 16;
var WaveSample = class WaveSample2 extends DLSVerifier {
  /**
  * Specifies the gain to be applied to this sample in 32 bit relative gain units.
  * Each unit of gain represents 1/655360 dB.
  */
  gain = 0;
  /**
  * Specifies the MIDI note which will replay the sample at original pitch. This value ranges
  * from 0 to 127 (a value of 60 represents Middle C, as defined by the MIDI specification).
  */
  unityNote = 60;
  /**
  * Specifies the tuning offset from the usUnityNote in 16 bit relative pitch. (cents)
  */
  fineTune = 0;
  /**
  * Specifies the number (count) of <wavesample-loop> records that are contained in the
  * <wsmp-ck> chunk. The <wavesample-loop> records are stored immediately following the
  * cSampleLoops data field. One shot sounds will have the cSampleLoops field set to 0.
  * Looped sounds will have the cSampleLoops field set to 1. Values greater than 1 are not yet
  * defined at this time.
  */
  loops = new Array();
  /**
  * Specifies flag options for the digital audio sample.
  * Default to F_WSMP_NO_COMPRESSION,
  * according to all DLS files I have.
  */
  fulOptions = 2;
  static copyFrom(inputWaveSample) {
    const outputWaveSample = new WaveSample2();
    outputWaveSample.unityNote = inputWaveSample.unityNote;
    outputWaveSample.gain = inputWaveSample.gain;
    outputWaveSample.fineTune = inputWaveSample.fineTune;
    outputWaveSample.loops = inputWaveSample.loops.map((l) => {
      return { ...l };
    });
    outputWaveSample.fulOptions = inputWaveSample.fulOptions;
    return outputWaveSample;
  }
  static read(chunk) {
    this.verifyHeader(chunk, "wsmp");
    const waveSample = new WaveSample2();
    const cbSize = readLittleEndianIndexed(chunk.data, 4);
    if (cbSize !== WSMP_SIZE) SpessaSynthWarn(`Wsmp cbSize mismatch: got ${cbSize}, expected ${WSMP_SIZE}.`);
    waveSample.unityNote = readLittleEndianIndexed(chunk.data, 2);
    waveSample.fineTune = signedInt16(chunk.data[chunk.data.currentIndex++], chunk.data[chunk.data.currentIndex++]);
    waveSample.gain = readLittleEndianIndexed(chunk.data, 4) | 0;
    waveSample.fulOptions = readLittleEndianIndexed(chunk.data, 4);
    if (readLittleEndianIndexed(chunk.data, 4) === 0) {
    } else {
      const cbSize2 = readLittleEndianIndexed(chunk.data, 4);
      if (cbSize2 !== WSMP_LOOP_SIZE) SpessaSynthWarn(`CbSize for loop in wsmp mismatch. Expected ${WSMP_LOOP_SIZE}, got ${cbSize2}.`);
      const loopType = readLittleEndianIndexed(chunk.data, 4);
      const loopStart = readLittleEndianIndexed(chunk.data, 4);
      const loopLength = readLittleEndianIndexed(chunk.data, 4);
      waveSample.loops.push({
        loopStart,
        loopLength,
        loopType
      });
    }
    return waveSample;
  }
  static fromSFSample(sample) {
    const waveSample = new WaveSample2();
    waveSample.unityNote = sample.originalKey;
    waveSample.fineTune = sample.pitchCorrection;
    if (sample.loopEnd !== 0 || sample.loopStart !== 0) waveSample.loops.push({
      loopStart: sample.loopStart,
      loopLength: sample.loopEnd - sample.loopStart,
      loopType: DLSLoopTypes.forward
    });
    return waveSample;
  }
  static fromSFZone(zone) {
    const waveSample = new WaveSample2();
    waveSample.unityNote = zone.getGenerator(generatorTypes.overridingRootKey, zone.sample.originalKey);
    if (zone.getGenerator(generatorTypes.scaleTuning, 100) === 0 && zone.keyRange.max - zone.keyRange.min === 0) waveSample.unityNote = zone.keyRange.min;
    waveSample.fineTune = zone.fineTuning + zone.sample.pitchCorrection;
    waveSample.gain = -(zone.getGenerator(generatorTypes.initialAttenuation, 0) * 0.4) << 16;
    const loopingMode = zone.getGenerator(generatorTypes.sampleModes, 0);
    if (loopingMode !== 0) {
      const loopStart = zone.sample.loopStart + zone.getGenerator(generatorTypes.startloopAddrsOffset, 0) + zone.getGenerator(generatorTypes.startloopAddrsCoarseOffset, 0) * 32768;
      const loopEnd = zone.sample.loopEnd + zone.getGenerator(generatorTypes.endloopAddrsOffset, 0) + zone.getGenerator(generatorTypes.endloopAddrsCoarseOffset, 0) * 32768;
      let dlsLoopType;
      switch (loopingMode) {
        case 1:
        default:
          dlsLoopType = 0;
          break;
        case 3:
          dlsLoopType = 1;
      }
      waveSample.loops.push({
        loopType: dlsLoopType,
        loopStart,
        loopLength: loopEnd - loopStart
      });
    }
    return waveSample;
  }
  /**
  * Converts the wsmp data into an SF zone.
  */
  toSFZone(zone, sample) {
    let loopingMode = 0;
    const loop = this.loops[0];
    if (loop) loopingMode = loop.loopType === DLSLoopTypes.loopAndRelease ? 3 : 1;
    if (loopingMode !== 0) zone.setGenerator(generatorTypes.sampleModes, loopingMode);
    const wsmpAttenuationCorrected = -(this.gain >> 16) / 0.4;
    if (wsmpAttenuationCorrected !== 0) zone.setGenerator(generatorTypes.initialAttenuation, wsmpAttenuationCorrected);
    zone.fineTuning = this.fineTune - sample.pitchCorrection;
    if (this.unityNote !== sample.originalKey) zone.setGenerator(generatorTypes.overridingRootKey, this.unityNote);
    if (loop) {
      const diffStart = loop.loopStart - sample.loopStart;
      const diffEnd = loop.loopStart + loop.loopLength - sample.loopEnd;
      if (diffStart !== 0) {
        const fine = diffStart % 32768;
        zone.setGenerator(generatorTypes.startloopAddrsOffset, fine);
        const coarse = Math.trunc(diffStart / 32768);
        if (coarse !== 0) zone.setGenerator(generatorTypes.startloopAddrsCoarseOffset, coarse);
      }
      if (diffEnd !== 0) {
        const fine = diffEnd % 32768;
        zone.setGenerator(generatorTypes.endloopAddrsOffset, fine);
        const coarse = Math.trunc(diffEnd / 32768);
        if (coarse !== 0) zone.setGenerator(generatorTypes.endloopAddrsCoarseOffset, coarse);
      }
    }
  }
  write() {
    const wsmpData = new IndexedByteArray(WSMP_SIZE + this.loops.length * WSMP_LOOP_SIZE);
    writeDword(wsmpData, WSMP_SIZE);
    writeWord(wsmpData, this.unityNote);
    writeWord(wsmpData, this.fineTune);
    writeDword(wsmpData, this.gain);
    writeDword(wsmpData, this.fulOptions);
    writeDword(wsmpData, this.loops.length);
    for (const loop of this.loops) {
      writeDword(wsmpData, WSMP_LOOP_SIZE);
      writeDword(wsmpData, loop.loopType);
      writeDword(wsmpData, loop.loopStart);
      writeDword(wsmpData, loop.loopLength);
    }
    return RIFFChunk.write("wsmp", wsmpData);
  }
};
var W_FORMAT_TAG = {
  PCM: 1,
  ALAW: 6
};
function readPCM(data, bytesPerSample) {
  const maxSampleValue = Math.pow(2, bytesPerSample * 8 - 1);
  const maxUnsigned = Math.pow(2, bytesPerSample * 8);
  let normalizationFactor;
  let isUnsigned = false;
  if (bytesPerSample === 1) {
    normalizationFactor = 255;
    isUnsigned = true;
  } else normalizationFactor = maxSampleValue;
  const sampleLength = data.length / bytesPerSample;
  const sampleData = new Float32Array(sampleLength);
  if (bytesPerSample === 2) {
    const s16 = new Int16Array(data.buffer);
    for (const [i, element] of s16.entries()) sampleData[i] = element / 32768;
  } else for (let i = 0; i < sampleData.length; i++) {
    let sample = readLittleEndianIndexed(data, bytesPerSample);
    if (isUnsigned) sampleData[i] = sample / normalizationFactor - 0.5;
    else {
      if (sample >= maxSampleValue) sample -= maxUnsigned;
      sampleData[i] = sample / normalizationFactor;
    }
  }
  return sampleData;
}
function readALAW(data, bytesPerSample) {
  const sampleLength = data.length / bytesPerSample;
  const sampleData = new Float32Array(sampleLength);
  for (let i = 0; i < sampleData.length; i++) {
    const input = readLittleEndianIndexed(data, bytesPerSample);
    let sample = input ^ 85;
    sample &= 127;
    const exponent = sample >> 4;
    let mantissa = sample & 15;
    if (exponent > 0) mantissa += 16;
    mantissa = (mantissa << 4) + 8;
    if (exponent > 1) mantissa = mantissa << exponent - 1;
    sampleData[i] = (input > 127 ? mantissa : -mantissa) / 32768;
  }
  return sampleData;
}
var DLSSample = class extends BasicSample {
  wFormatTag;
  bytesPerSample;
  /**
  * Sample's raw data before decoding it, for faster writing
  */
  rawData;
  /**
  * @param name
  * @param rate
  * @param pitch
  * @param pitchCorrection
  * @param loopStart sample data points
  * @param loopEnd sample data points
  * @param dataChunk
  * @param wFormatTag
  * @param bytesPerSample
  */
  constructor(name, rate, pitch, pitchCorrection, loopStart, loopEnd, dataChunk, wFormatTag, bytesPerSample) {
    super(name, rate, pitch, pitchCorrection, sampleTypes.monoSample, loopStart, loopEnd);
    this.dataOverridden = false;
    this.rawData = dataChunk.data;
    this.wFormatTag = wFormatTag;
    this.bytesPerSample = bytesPerSample;
  }
  getAudioData() {
    if (!this.rawData) return new Float32Array(0);
    if (!this.audioData) {
      let sampleData;
      switch (this.wFormatTag) {
        default:
          SpessaSynthWarn(`Failed to decode sample. Unknown wFormatTag: ${this.wFormatTag}`);
          sampleData = new Float32Array(this.rawData.length / this.bytesPerSample);
          break;
        case W_FORMAT_TAG.PCM:
          sampleData = readPCM(this.rawData, this.bytesPerSample);
          break;
        case W_FORMAT_TAG.ALAW:
          sampleData = readALAW(this.rawData, this.bytesPerSample);
          break;
      }
      this.setAudioData(sampleData, this.sampleRate);
    }
    return this.audioData ?? new Float32Array(0);
  }
  getRawData(allowVorbis) {
    if (this.dataOverridden || this.isCompressed) return super.getRawData(allowVorbis);
    if (this.wFormatTag === W_FORMAT_TAG.PCM && this.bytesPerSample === 2) return this.rawData;
    return this.encodeS16LE();
  }
};
var DownloadableSoundsSample = class DownloadableSoundsSample2 extends DLSVerifier {
  waveSample = new WaveSample();
  wFormatTag;
  bytesPerSample;
  sampleRate;
  dataChunk;
  name = "Unnamed sample";
  constructor(wFormatTag, bytesPerSample, sampleRate, dataChunk) {
    super();
    this.wFormatTag = wFormatTag;
    this.bytesPerSample = bytesPerSample;
    this.sampleRate = sampleRate;
    this.dataChunk = dataChunk;
  }
  static read(waveChunk) {
    const chunks = this.verifyAndReadList(waveChunk, "wave");
    const fmtChunk = chunks.find((c) => c.header === "fmt ");
    if (!fmtChunk) throw new Error("No fmt chunk in the wave file!");
    const wFormatTag = readLittleEndianIndexed(fmtChunk.data, 2);
    const channelsAmount = readLittleEndianIndexed(fmtChunk.data, 2);
    if (channelsAmount !== 1) throw new Error(`Only mono samples are supported. Fmt reports ${channelsAmount} channels.`);
    const sampleRate = readLittleEndianIndexed(fmtChunk.data, 4);
    readLittleEndianIndexed(fmtChunk.data, 4);
    readLittleEndianIndexed(fmtChunk.data, 2);
    const bytesPerSample = readLittleEndianIndexed(fmtChunk.data, 2) / 8;
    const dataChunk = chunks.find((c) => c.header === "data");
    if (!dataChunk) throw new Error("No data chunk in the WAVE chunk!");
    const sample = new DownloadableSoundsSample2(wFormatTag, bytesPerSample, sampleRate, dataChunk);
    const waveInfo = RIFFChunk.findListType(chunks, "INFO");
    if (waveInfo) {
      let infoChunk = RIFFChunk.read(waveInfo.data);
      while (infoChunk.header !== "INAM" && waveInfo.data.currentIndex < waveInfo.data.length) infoChunk = RIFFChunk.read(waveInfo.data);
      if (infoChunk.header === "INAM") sample.name = readBinaryStringIndexed(infoChunk.data, infoChunk.size).trim();
    }
    const wsmpChunk = chunks.find((c) => c.header === "wsmp");
    if (wsmpChunk) sample.waveSample = WaveSample.read(wsmpChunk);
    return sample;
  }
  static fromSFSample(sample) {
    const raw = sample.getRawData(false);
    const dlsSample = new DownloadableSoundsSample2(1, 2, sample.sampleRate, new RIFFChunk("data", raw.length, new IndexedByteArray(raw.buffer)));
    dlsSample.name = sample.name;
    dlsSample.waveSample = WaveSample.fromSFSample(sample);
    return dlsSample;
  }
  toSFSample(soundBank) {
    let originalKey = this.waveSample.unityNote;
    let pitchCorrection = this.waveSample.fineTune;
    const samplePitchSemitones = Math.trunc(pitchCorrection / 100);
    originalKey += samplePitchSemitones;
    pitchCorrection -= samplePitchSemitones * 100;
    let loopStart = 0;
    let loopEnd = 0;
    const loop = this.waveSample.loops?.[0];
    if (loop) {
      loopStart = loop.loopStart;
      loopEnd = loop.loopStart + loop.loopLength;
    }
    const sample = new DLSSample(this.name, this.sampleRate, originalKey, pitchCorrection, loopStart, loopEnd, this.dataChunk, this.wFormatTag, this.bytesPerSample);
    soundBank.addSamples(sample);
  }
  write() {
    const fmt = this.writeFmt();
    const wsmp = this.waveSample.write();
    const data = RIFFChunk.write("data", this.dataChunk.data);
    const inam = RIFFChunk.write("INAM", getStringBytes(this.name, true));
    const info = RIFFChunk.write("INFO", inam, false, true);
    SpessaSynthInfo(`%cSaved %c${this.name}%c successfully!`, consoleColors.recognized, consoleColors.value, consoleColors.recognized);
    return RIFFChunk.writeParts("wave", [
      fmt,
      wsmp,
      data,
      info
    ], true);
  }
  writeFmt() {
    const fmtData = new IndexedByteArray(18);
    writeWord(fmtData, this.wFormatTag);
    writeWord(fmtData, 1);
    writeDword(fmtData, this.sampleRate);
    writeDword(fmtData, this.sampleRate * 2);
    writeWord(fmtData, 2);
    writeWord(fmtData, this.bytesPerSample * 8);
    return RIFFChunk.write("fmt ", fmtData);
  }
};
var ConnectionSource = class ConnectionSource2 {
  source;
  transform;
  bipolar;
  invert;
  constructor(source = dlsSources.none, transform = modulatorCurveTypes.linear, bipolar = false, invert = false) {
    this.source = source;
    this.transform = transform;
    this.bipolar = bipolar;
    this.invert = invert;
  }
  get sourceName() {
    return Object.keys(dlsSources).find((k) => dlsSources[k] === this.source) ?? this.source.toString();
  }
  get transformName() {
    return Object.keys(modulatorCurveTypes).find((k) => modulatorCurveTypes[k] === this.transform) ?? this.transform.toString();
  }
  static copyFrom(inputSource) {
    return new ConnectionSource2(inputSource.source, inputSource.transform, inputSource.bipolar, inputSource.invert);
  }
  static fromSFSource(source) {
    let sourceEnum = void 0;
    if (source.isCC) switch (source.index) {
      case midiControllers.modulationWheel:
        sourceEnum = dlsSources.modulationWheel;
        break;
      case midiControllers.mainVolume:
        sourceEnum = dlsSources.volume;
        break;
      case midiControllers.pan:
        sourceEnum = dlsSources.pan;
        break;
      case midiControllers.expressionController:
        sourceEnum = dlsSources.expression;
        break;
      case midiControllers.chorusDepth:
        sourceEnum = dlsSources.chorus;
        break;
      case midiControllers.reverbDepth:
        sourceEnum = dlsSources.reverb;
        break;
    }
    else switch (source.index) {
      case modulatorSources.noController:
        sourceEnum = dlsSources.none;
        break;
      case modulatorSources.noteOnKeyNum:
        sourceEnum = dlsSources.keyNum;
        break;
      case modulatorSources.noteOnVelocity:
        sourceEnum = dlsSources.velocity;
        break;
      case modulatorSources.pitchWheel:
        sourceEnum = dlsSources.pitchWheel;
        break;
      case modulatorSources.pitchWheelRange:
        sourceEnum = dlsSources.pitchWheelRange;
        break;
      case modulatorSources.polyPressure:
        sourceEnum = dlsSources.polyPressure;
        break;
      case modulatorSources.channelPressure:
        sourceEnum = dlsSources.channelPressure;
    }
    if (sourceEnum === void 0) return;
    return new ConnectionSource2(sourceEnum, source.curveType, source.isBipolar, source.isNegative);
  }
  toString() {
    return `${this.sourceName} ${this.transformName} ${this.bipolar ? "bipolar" : "unipolar"} ${this.invert ? "inverted" : "positive"}`;
  }
  toTransformFlag() {
    return this.transform | (this.bipolar ? 1 : 0) << 4 | (this.invert ? 1 : 0) << 5;
  }
  toSFSource() {
    let sourceEnum;
    let isCC = false;
    switch (this.source) {
      default:
      case dlsSources.modLfo:
      case dlsSources.vibratoLfo:
      case dlsSources.coarseTune:
      case dlsSources.fineTune:
      case dlsSources.modEnv:
        return;
      case dlsSources.keyNum:
        sourceEnum = modulatorSources.noteOnKeyNum;
        break;
      case dlsSources.none:
        sourceEnum = modulatorSources.noController;
        break;
      case dlsSources.modulationWheel:
        sourceEnum = midiControllers.modulationWheel;
        isCC = true;
        break;
      case dlsSources.pan:
        sourceEnum = midiControllers.pan;
        isCC = true;
        break;
      case dlsSources.reverb:
        sourceEnum = midiControllers.reverbDepth;
        isCC = true;
        break;
      case dlsSources.chorus:
        sourceEnum = midiControllers.chorusDepth;
        isCC = true;
        break;
      case dlsSources.expression:
        sourceEnum = midiControllers.expressionController;
        isCC = true;
        break;
      case dlsSources.volume:
        sourceEnum = midiControllers.mainVolume;
        isCC = true;
        break;
      case dlsSources.velocity:
        sourceEnum = modulatorSources.noteOnVelocity;
        break;
      case dlsSources.polyPressure:
        sourceEnum = modulatorSources.polyPressure;
        break;
      case dlsSources.channelPressure:
        sourceEnum = modulatorSources.channelPressure;
        break;
      case dlsSources.pitchWheel:
        sourceEnum = modulatorSources.pitchWheel;
        break;
      case dlsSources.pitchWheelRange:
        sourceEnum = modulatorSources.pitchWheelRange;
        break;
    }
    if (sourceEnum === void 0) return;
    return new ModulatorSource(sourceEnum, this.transform, isCC, this.bipolar, this.invert);
  }
};
var DEFAULT_DLS_REVERB = new DecodedModulator(219, 0, generatorTypes.reverbEffectsSend, 1e3, 0);
var DEFAULT_DLS_CHORUS = new DecodedModulator(221, 0, generatorTypes.chorusEffectsSend, 1e3, 0);
new DecodedModulator(129, 0, generatorTypes.vibLfoToPitch, 0, 0);
new DecodedModulator(13, 0, generatorTypes.vibLfoToPitch, 0, 0);
var invalidGeneratorTypes = /* @__PURE__ */ new Set([
  generatorTypes.sampleModes,
  generatorTypes.initialAttenuation,
  generatorTypes.keyRange,
  generatorTypes.velRange,
  generatorTypes.sampleID,
  generatorTypes.fineTune,
  generatorTypes.coarseTune,
  generatorTypes.startAddrsOffset,
  generatorTypes.startAddrsCoarseOffset,
  generatorTypes.endAddrOffset,
  generatorTypes.endAddrsCoarseOffset,
  generatorTypes.startloopAddrsOffset,
  generatorTypes.startloopAddrsCoarseOffset,
  generatorTypes.endloopAddrsOffset,
  generatorTypes.endloopAddrsCoarseOffset,
  generatorTypes.overridingRootKey,
  generatorTypes.exclusiveClass
]);
var ConnectionBlock = class ConnectionBlock2 {
  /**
  * Like SF2 modulator source.
  */
  source;
  /**
  * Like SF2 modulator secondary source.
  */
  control;
  /**
  * Like SF2 destination.
  */
  destination;
  /**
  * Like SF2 amount, but long (32-bit) instead of short.
  */
  scale;
  /**
  * Like SF2 source transforms.
  */
  transform;
  constructor(source = new ConnectionSource(), control = new ConnectionSource(), destination, transform, scale) {
    this.source = source;
    this.control = control;
    this.destination = destination;
    this.transform = transform;
    this.scale = scale;
  }
  get isStaticParameter() {
    return this.source.source === dlsSources.none && this.control.source === dlsSources.none;
  }
  get shortScale() {
    return this.scale >> 16;
  }
  get transformName() {
    return Object.keys(modulatorCurveTypes).find((k) => modulatorCurveTypes[k] === this.transform) ?? this.transform.toString();
  }
  get destinationName() {
    return Object.keys(dlsDestinations).find((k) => dlsDestinations[k] === this.destination) ?? this.destination.toString();
  }
  static read(artData) {
    const usSource = readLittleEndianIndexed(artData, 2);
    const usControl = readLittleEndianIndexed(artData, 2);
    const usDestination = readLittleEndianIndexed(artData, 2);
    const usTransform = readLittleEndianIndexed(artData, 2);
    const lScale = readLittleEndianIndexed(artData, 4) | 0;
    const transform = usTransform & 15;
    const control = new ConnectionSource(usControl, usTransform >> 4 & 15, bitMaskToBool(usTransform, 8), bitMaskToBool(usTransform, 9));
    return new ConnectionBlock2(new ConnectionSource(usSource, usTransform >> 10 & 15, bitMaskToBool(usTransform, 14), bitMaskToBool(usTransform, 15)), control, usDestination, transform, lScale);
  }
  static fromSFModulator(m, articulation) {
    const failed = (msg) => {
      SpessaSynthWarn(`Failed converting SF modulator into DLS:
 ${m.toString()} 
(${msg})`);
    };
    if (m.transformType !== 0) {
      failed("Absolute transform type is not supported");
      return;
    }
    if (Modulator.isIdentical(m, DEFAULT_DLS_CHORUS, true) || Modulator.isIdentical(m, DEFAULT_DLS_REVERB, true)) return;
    let source = ConnectionSource.fromSFSource(m.primarySource);
    if (!source) {
      failed("Invalid primary source");
      return;
    }
    let control = ConnectionSource.fromSFSource(m.secondarySource);
    if (!control) {
      failed("Invalid secondary source");
      return;
    }
    const dlsDestination = ConnectionBlock2.fromSFDestination(m.destination, m.transformAmount);
    if (dlsDestination === void 0) {
      failed("Invalid destination");
      return;
    }
    let amount = m.transformAmount;
    let destination;
    if (typeof dlsDestination === "number") destination = dlsDestination;
    else {
      destination = dlsDestination.destination;
      amount = dlsDestination.amount;
      if (dlsDestination.source !== dlsSources.none) {
        if (control.source !== dlsSources.none && source.source !== dlsSources.none) {
          failed("Articulation generators with secondary source are not supported");
          return;
        }
        if (source.source !== dlsSources.none) control = source;
        source = new ConnectionSource(dlsDestination.source, modulatorCurveTypes.linear, dlsDestination.isBipolar);
      }
    }
    const bloc = new ConnectionBlock2(source, control, destination, 0, amount << 16);
    articulation.connectionBlocks.push(bloc);
  }
  static copyFrom(inputBlock) {
    return new ConnectionBlock2(ConnectionSource.copyFrom(inputBlock.source), ConnectionSource.copyFrom(inputBlock.control), inputBlock.destination, inputBlock.transform, inputBlock.scale);
  }
  static fromSFGenerator(generator, articulation) {
    if (invalidGeneratorTypes.has(generator.generatorType)) return;
    const failed = (msg) => {
      SpessaSynthWarn(`Failed converting SF2 generator into DLS:
 ${generator.toString()} 
(${msg})`);
    };
    const dlsDestination = ConnectionBlock2.fromSFDestination(generator.generatorType, generator.generatorValue);
    if (dlsDestination === void 0) {
      failed("Invalid type");
      return;
    }
    const source = new ConnectionSource();
    let destination;
    let amount = generator.generatorValue;
    if (typeof dlsDestination === "number") destination = dlsDestination;
    else {
      destination = dlsDestination.destination;
      amount = dlsDestination.amount;
      source.source = dlsDestination.source;
      source.bipolar = dlsDestination.isBipolar;
    }
    articulation.connectionBlocks.push(new ConnectionBlock2(source, new ConnectionSource(), destination, 0, amount << 16));
  }
  static fromSFDestination(dest, amount) {
    switch (dest) {
      default:
        return;
      case generatorTypes.initialAttenuation:
        return {
          destination: dlsDestinations.gain,
          amount: -amount,
          isBipolar: false,
          source: dlsSources.none
        };
      case generatorTypes.fineTune:
        return dlsDestinations.pitch;
      case generatorTypes.pan:
        return dlsDestinations.pan;
      case generatorTypes.keyNum:
        return dlsDestinations.keyNum;
      case generatorTypes.reverbEffectsSend:
        return dlsDestinations.reverbSend;
      case generatorTypes.chorusEffectsSend:
        return dlsDestinations.chorusSend;
      case generatorTypes.freqModLFO:
        return dlsDestinations.modLfoFreq;
      case generatorTypes.delayModLFO:
        return dlsDestinations.modLfoDelay;
      case generatorTypes.delayVibLFO:
        return dlsDestinations.vibLfoDelay;
      case generatorTypes.freqVibLFO:
        return dlsDestinations.vibLfoFreq;
      case generatorTypes.delayVolEnv:
        return dlsDestinations.volEnvDelay;
      case generatorTypes.attackVolEnv:
        return dlsDestinations.volEnvAttack;
      case generatorTypes.holdVolEnv:
        return dlsDestinations.volEnvHold;
      case generatorTypes.decayVolEnv:
        return dlsDestinations.volEnvDecay;
      case generatorTypes.sustainVolEnv:
        return {
          destination: dlsDestinations.volEnvSustain,
          amount: 1e3 - amount,
          isBipolar: false,
          source: dlsSources.none
        };
      case generatorTypes.releaseVolEnv:
        return dlsDestinations.volEnvRelease;
      case generatorTypes.delayModEnv:
        return dlsDestinations.modEnvDelay;
      case generatorTypes.attackModEnv:
        return dlsDestinations.modEnvAttack;
      case generatorTypes.holdModEnv:
        return dlsDestinations.modEnvHold;
      case generatorTypes.decayModEnv:
        return dlsDestinations.modEnvDecay;
      case generatorTypes.sustainModEnv:
        return {
          destination: dlsDestinations.modEnvSustain,
          amount: 1e3 - amount,
          isBipolar: false,
          source: dlsSources.none
        };
      case generatorTypes.releaseModEnv:
        return dlsDestinations.modEnvRelease;
      case generatorTypes.initialFilterFc:
        return dlsDestinations.filterCutoff;
      case generatorTypes.initialFilterQ:
        return dlsDestinations.filterQ;
      case generatorTypes.modEnvToFilterFc:
        return {
          source: dlsSources.modEnv,
          destination: dlsDestinations.filterCutoff,
          amount,
          isBipolar: false
        };
      case generatorTypes.modEnvToPitch:
        return {
          source: dlsSources.modEnv,
          destination: dlsDestinations.pitch,
          amount,
          isBipolar: false
        };
      case generatorTypes.modLfoToFilterFc:
        return {
          source: dlsSources.modLfo,
          destination: dlsDestinations.filterCutoff,
          amount,
          isBipolar: true
        };
      case generatorTypes.modLfoToVolume:
        return {
          source: dlsSources.modLfo,
          destination: dlsDestinations.gain,
          amount,
          isBipolar: true
        };
      case generatorTypes.modLfoToPitch:
        return {
          source: dlsSources.modLfo,
          destination: dlsDestinations.pitch,
          amount,
          isBipolar: true
        };
      case generatorTypes.vibLfoToPitch:
        return {
          source: dlsSources.vibratoLfo,
          destination: dlsDestinations.pitch,
          amount,
          isBipolar: true
        };
      case generatorTypes.keyNumToVolEnvHold:
        return {
          source: dlsSources.keyNum,
          destination: dlsDestinations.volEnvHold,
          amount,
          isBipolar: true
        };
      case generatorTypes.keyNumToVolEnvDecay:
        return {
          source: dlsSources.keyNum,
          destination: dlsDestinations.volEnvDecay,
          amount,
          isBipolar: true
        };
      case generatorTypes.keyNumToModEnvHold:
        return {
          source: dlsSources.keyNum,
          destination: dlsDestinations.modEnvHold,
          amount,
          isBipolar: true
        };
      case generatorTypes.keyNumToModEnvDecay:
        return {
          source: dlsSources.keyNum,
          destination: dlsDestinations.modEnvDecay,
          amount,
          isBipolar: true
        };
      case generatorTypes.scaleTuning:
        return {
          source: dlsSources.keyNum,
          destination: dlsDestinations.pitch,
          amount: amount * 128,
          isBipolar: false
        };
    }
  }
  toString() {
    return `Source: ${this.source.toString()},
Control: ${this.control.toString()},
Scale: ${this.scale} >> 16 = ${this.shortScale},
Output transform: ${this.transformName}
Destination: ${this.destinationName}`;
  }
  write() {
    const out = new IndexedByteArray(12);
    writeWord(out, this.source.source);
    writeWord(out, this.control.source);
    writeWord(out, this.destination);
    writeWord(out, this.transform | this.control.toTransformFlag() << 4 | this.source.toTransformFlag() << 10);
    writeDword(out, this.scale);
    return out;
  }
  toSFGenerator(zone) {
    const destination = this.destination;
    const value = this.shortScale;
    switch (destination) {
      default:
        SpessaSynthInfo(`%cFailed converting DLS articulator into SF generator: %c${this.toString()}%c
(invalid destination)`, consoleColors.warn, consoleColors.value, consoleColors.unrecognized);
        return;
      case dlsDestinations.pan:
        zone.setGenerator(generatorTypes.pan, value);
        break;
      case dlsDestinations.gain:
        zone.addToGenerator(generatorTypes.initialAttenuation, -value / 0.4);
        break;
      case dlsDestinations.filterCutoff:
        zone.setGenerator(generatorTypes.initialFilterFc, value);
        break;
      case dlsDestinations.filterQ:
        zone.setGenerator(generatorTypes.initialFilterQ, value);
        break;
      case dlsDestinations.modLfoFreq:
        zone.setGenerator(generatorTypes.freqModLFO, value);
        break;
      case dlsDestinations.modLfoDelay:
        zone.setGenerator(generatorTypes.delayModLFO, value);
        break;
      case dlsDestinations.vibLfoFreq:
        zone.setGenerator(generatorTypes.freqVibLFO, value);
        break;
      case dlsDestinations.vibLfoDelay:
        zone.setGenerator(generatorTypes.delayVibLFO, value);
        break;
      case dlsDestinations.volEnvDelay:
        zone.setGenerator(generatorTypes.delayVolEnv, value);
        break;
      case dlsDestinations.volEnvAttack:
        zone.setGenerator(generatorTypes.attackVolEnv, value);
        break;
      case dlsDestinations.volEnvHold:
        zone.setGenerator(generatorTypes.holdVolEnv, value);
        break;
      case dlsDestinations.volEnvDecay:
        zone.setGenerator(generatorTypes.decayVolEnv, value);
        break;
      case dlsDestinations.volEnvRelease:
        zone.setGenerator(generatorTypes.releaseVolEnv, value);
        break;
      case dlsDestinations.volEnvSustain:
        zone.setGenerator(generatorTypes.sustainVolEnv, 1e3 - value);
        break;
      case dlsDestinations.modEnvDelay:
        zone.setGenerator(generatorTypes.delayModEnv, value);
        break;
      case dlsDestinations.modEnvAttack:
        zone.setGenerator(generatorTypes.attackModEnv, value);
        break;
      case dlsDestinations.modEnvHold:
        zone.setGenerator(generatorTypes.holdModEnv, value);
        break;
      case dlsDestinations.modEnvDecay:
        zone.setGenerator(generatorTypes.decayModEnv, value);
        break;
      case dlsDestinations.modEnvRelease:
        zone.setGenerator(generatorTypes.releaseModEnv, value);
        break;
      case dlsDestinations.modEnvSustain:
        zone.setGenerator(generatorTypes.sustainModEnv, 1e3 - value);
        break;
      case dlsDestinations.reverbSend:
        zone.setGenerator(generatorTypes.reverbEffectsSend, value);
        break;
      case dlsDestinations.chorusSend:
        zone.setGenerator(generatorTypes.chorusEffectsSend, value);
        break;
      case dlsDestinations.pitch:
        zone.fineTuning += value;
        break;
    }
  }
  toSFModulator(zone) {
    let amount = this.shortScale;
    let modulatorDestination;
    let primarySource;
    let secondarySource = new ModulatorSource();
    const specialDestination = this.toCombinedSFDestination();
    if (specialDestination) {
      modulatorDestination = specialDestination;
      const controlSF = this.control.toSFSource();
      if (!controlSF) {
        this.failedConversion("Invalid control");
        return;
      }
      primarySource = controlSF;
    } else {
      const convertedDestination = this.toSFDestination();
      if (!convertedDestination) {
        this.failedConversion("Invalid destination");
        return;
      }
      if (typeof convertedDestination === "object") {
        amount = convertedDestination.newAmount;
        modulatorDestination = convertedDestination.gen;
      } else modulatorDestination = convertedDestination;
      const convertedPrimary = this.source.toSFSource();
      if (!convertedPrimary) {
        this.failedConversion("Invalid source");
        return;
      }
      primarySource = convertedPrimary;
      const convertedSecondary = this.control.toSFSource();
      if (!convertedSecondary) {
        this.failedConversion("Invalid control");
        return;
      }
      secondarySource = convertedSecondary;
    }
    if (this.transform !== modulatorCurveTypes.linear && primarySource.curveType === modulatorCurveTypes.linear) primarySource.curveType = this.transform;
    if (modulatorDestination === generatorTypes.initialAttenuation) {
      if (this.source.source === dlsSources.velocity || this.source.source === dlsSources.volume || this.source.source === dlsSources.expression) primarySource.isNegative = true;
      amount = Math.min(960, Math.max(0, amount));
    }
    const mod = new Modulator(primarySource, secondarySource, modulatorDestination, amount, 0);
    zone.addModulators(mod);
  }
  /**
  * Checks for an SF generator that consists of DLS source and destination (such as mod LFO and pitch)
  * @returns either a matching SF generator or nothing.
  */
  toCombinedSFDestination() {
    const source = this.source.source;
    const destination = this.destination;
    if (source === dlsSources.vibratoLfo && destination === dlsDestinations.pitch) return generatorTypes.vibLfoToPitch;
    else if (source === dlsSources.modLfo && destination === dlsDestinations.pitch) return generatorTypes.modLfoToPitch;
    else if (source === dlsSources.modLfo && destination === dlsDestinations.filterCutoff) return generatorTypes.modLfoToFilterFc;
    else if (source === dlsSources.modLfo && destination === dlsDestinations.gain) return generatorTypes.modLfoToVolume;
    else if (source === dlsSources.modEnv && destination === dlsDestinations.filterCutoff) return generatorTypes.modEnvToFilterFc;
    else if (source === dlsSources.modEnv && destination === dlsDestinations.pitch) return generatorTypes.modEnvToPitch;
    else return;
  }
  failedConversion(msg) {
    SpessaSynthInfo(`%cFailed converting DLS articulator into SF2:
 %c${this.toString()}%c
(${msg})`, consoleColors.warn, consoleColors.value, consoleColors.unrecognized);
  }
  /**
  * Converts DLS destination of this block to an SF2 one, also with the correct amount.
  * @private
  */
  toSFDestination() {
    const amount = this.shortScale;
    switch (this.destination) {
      default:
      case dlsDestinations.none:
        return;
      case dlsDestinations.pan:
        return generatorTypes.pan;
      case dlsDestinations.gain:
        return {
          gen: generatorTypes.initialAttenuation,
          newAmount: -amount
        };
      case dlsDestinations.pitch:
        return generatorTypes.fineTune;
      case dlsDestinations.keyNum:
        return generatorTypes.overridingRootKey;
      case dlsDestinations.volEnvDelay:
        return generatorTypes.delayVolEnv;
      case dlsDestinations.volEnvAttack:
        return generatorTypes.attackVolEnv;
      case dlsDestinations.volEnvHold:
        return generatorTypes.holdVolEnv;
      case dlsDestinations.volEnvDecay:
        return generatorTypes.decayVolEnv;
      case dlsDestinations.volEnvSustain:
        return {
          gen: generatorTypes.sustainVolEnv,
          newAmount: 1e3 - amount
        };
      case dlsDestinations.volEnvRelease:
        return generatorTypes.releaseVolEnv;
      case dlsDestinations.modEnvDelay:
        return generatorTypes.delayModEnv;
      case dlsDestinations.modEnvAttack:
        return generatorTypes.attackModEnv;
      case dlsDestinations.modEnvHold:
        return generatorTypes.holdModEnv;
      case dlsDestinations.modEnvDecay:
        return generatorTypes.decayModEnv;
      case dlsDestinations.modEnvSustain:
        return {
          gen: generatorTypes.sustainModEnv,
          newAmount: 1e3 - amount
        };
      case dlsDestinations.modEnvRelease:
        return generatorTypes.releaseModEnv;
      case dlsDestinations.filterCutoff:
        return generatorTypes.initialFilterFc;
      case dlsDestinations.filterQ:
        return generatorTypes.initialFilterQ;
      case dlsDestinations.chorusSend:
        return generatorTypes.chorusEffectsSend;
      case dlsDestinations.reverbSend:
        return generatorTypes.reverbEffectsSend;
      case dlsDestinations.modLfoFreq:
        return generatorTypes.freqModLFO;
      case dlsDestinations.modLfoDelay:
        return generatorTypes.delayModLFO;
      case dlsDestinations.vibLfoFreq:
        return generatorTypes.freqVibLFO;
      case dlsDestinations.vibLfoDelay:
        return generatorTypes.delayVibLFO;
    }
  }
};
var DownloadableSoundsArticulation = class extends DLSVerifier {
  connectionBlocks = new Array();
  mode = "dls2";
  get length() {
    return this.connectionBlocks.length;
  }
  copyFrom(inputArticulation) {
    this.mode = inputArticulation.mode;
    for (const block of inputArticulation.connectionBlocks) this.connectionBlocks.push(ConnectionBlock.copyFrom(block));
  }
  fromSFZone(z) {
    this.mode = "dls2";
    const zone = new BasicZone();
    zone.copyFrom(z);
    for (const relativeGenerator of zone.generators) {
      let absoluteCounterpart;
      switch (relativeGenerator.generatorType) {
        default:
          continue;
        case generatorTypes.keyNumToVolEnvDecay:
          absoluteCounterpart = generatorTypes.decayVolEnv;
          break;
        case generatorTypes.keyNumToVolEnvHold:
          absoluteCounterpart = generatorTypes.holdVolEnv;
          break;
        case generatorTypes.keyNumToModEnvDecay:
          absoluteCounterpart = generatorTypes.decayModEnv;
          break;
        case generatorTypes.keyNumToModEnvHold:
          absoluteCounterpart = generatorTypes.holdModEnv;
      }
      const absoluteValue = zone.getGenerator(absoluteCounterpart, void 0);
      const dlsRelative = relativeGenerator.generatorValue * -128;
      if (absoluteValue === void 0) continue;
      const newAbsolute = absoluteValue - 60 / 128 * dlsRelative;
      zone.setGenerator(relativeGenerator.generatorType, dlsRelative, false);
      zone.setGenerator(absoluteCounterpart, newAbsolute, false);
    }
    for (const generator of zone.generators) ConnectionBlock.fromSFGenerator(generator, this);
    for (const modulator of zone.modulators) ConnectionBlock.fromSFModulator(modulator, this);
  }
  /**
  * Chunk list for the region/instrument (containing lar2 or lart)
  * @param chunks
  */
  read(chunks) {
    const lart = RIFFChunk.findListType(chunks, "lart");
    const lar2 = RIFFChunk.findListType(chunks, "lar2");
    if (lart) {
      this.mode = "dls1";
      while (lart.data.currentIndex < lart.data.length) {
        const chunk = RIFFChunk.read(lart.data);
        if (chunk.header !== "art1" && chunk.header !== "art2") continue;
        const artData = chunk.data;
        const cbSize = readLittleEndianIndexed(artData, 4);
        if (cbSize !== 8) SpessaSynthWarn(`CbSize in articulation mismatch. Expected 8, got ${cbSize}`);
        const connectionsAmount = readLittleEndianIndexed(artData, 4);
        for (let i = 0; i < connectionsAmount; i++) this.connectionBlocks.push(ConnectionBlock.read(artData));
      }
    } else if (lar2) {
      this.mode = "dls2";
      while (lar2.data.currentIndex < lar2.data.length) {
        const chunk = RIFFChunk.read(lar2.data);
        if (chunk.header !== "art1" && chunk.header !== "art2") continue;
        const artData = chunk.data;
        const cbSize = readLittleEndianIndexed(artData, 4);
        if (cbSize !== 8) SpessaSynthWarn(`CbSize in articulation mismatch. Expected 8, got ${cbSize}`);
        const connectionsAmount = readLittleEndianIndexed(artData, 4);
        for (let i = 0; i < connectionsAmount; i++) this.connectionBlocks.push(ConnectionBlock.read(artData));
      }
    }
  }
  /**
  * Note: this writes "lar2", not just "art2"
  */
  write() {
    const art2Data = new IndexedByteArray(8);
    writeDword(art2Data, 8);
    writeDword(art2Data, this.connectionBlocks.length);
    const out = this.connectionBlocks.map((a) => a.write());
    const art2 = RIFFChunk.writeParts(this.mode === "dls2" ? "art2" : "art1", [art2Data, ...out]);
    return RIFFChunk.write(this.mode === "dls2" ? "lar2" : "lart", art2, false, true);
  }
  /**
  * Converts DLS articulation into an SF zone.
  * @param zone The zone to write to.
  */
  toSFZone(zone) {
    const applyKeyToCorrection = (value, keyToGen, realGen, dlsDestination) => {
      const keyToGenValue = value / -128;
      zone.setGenerator(keyToGen, keyToGenValue);
      if (keyToGenValue <= 120) {
        const correction = Math.round(60 / 128 * value);
        const realValueConnection = this.connectionBlocks.find((block) => block.isStaticParameter && block.destination === dlsDestination);
        if (realValueConnection) zone.setGenerator(realGen, correction + realValueConnection.shortScale);
      }
    };
    for (const connection of this.connectionBlocks) {
      const amount = connection.shortScale;
      const source = connection.source.source;
      const control = connection.control.source;
      const destination = connection.destination;
      if (connection.isStaticParameter) {
        connection.toSFGenerator(zone);
        continue;
      }
      if (control === dlsSources.none) if (source === dlsSources.keyNum) {
        if (destination === dlsDestinations.pitch) {
          zone.setGenerator(generatorTypes.scaleTuning, amount / 128);
          continue;
        }
        if (destination === dlsDestinations.modEnvHold || destination === dlsDestinations.modEnvDecay || destination === dlsDestinations.volEnvHold || destination === dlsDestinations.volEnvDecay) continue;
      } else {
        const specialGen = connection.toCombinedSFDestination();
        if (specialGen) {
          zone.setGenerator(specialGen, amount);
          continue;
        }
      }
      connection.toSFModulator(zone);
    }
    for (const connection of this.connectionBlocks) {
      if (connection.source.source !== dlsSources.keyNum) continue;
      const generatorAmount = connection.shortScale;
      switch (connection.destination) {
        default:
        case dlsDestinations.volEnvHold:
          applyKeyToCorrection(generatorAmount, generatorTypes.keyNumToVolEnvHold, generatorTypes.holdVolEnv, dlsDestinations.volEnvHold);
          break;
        case dlsDestinations.volEnvDecay:
          applyKeyToCorrection(generatorAmount, generatorTypes.keyNumToVolEnvDecay, generatorTypes.decayVolEnv, dlsDestinations.volEnvDecay);
          break;
        case dlsDestinations.modEnvHold:
          applyKeyToCorrection(generatorAmount, generatorTypes.keyNumToModEnvHold, generatorTypes.holdModEnv, dlsDestinations.modEnvHold);
          break;
        case dlsDestinations.modEnvDecay:
          applyKeyToCorrection(generatorAmount, generatorTypes.keyNumToModEnvDecay, generatorTypes.decayModEnv, dlsDestinations.modEnvDecay);
          break;
      }
    }
    if (this.mode === "dls1") {
      zone.setGenerator(generatorTypes.delayVibLFO, zone.getGenerator(generatorTypes.delayModLFO, null));
      zone.setGenerator(generatorTypes.freqVibLFO, zone.getGenerator(generatorTypes.freqModLFO, null));
      zone.setGenerator(generatorTypes.vibLfoToPitch, zone.getGenerator(generatorTypes.modLfoToPitch, null));
      zone.setGenerator(generatorTypes.modLfoToPitch, null);
      for (const mod of zone.modulators) if (mod.destination === generatorTypes.modLfoToPitch) mod.destination = generatorTypes.vibLfoToPitch;
    }
  }
};
var WaveLink = class WaveLink2 {
  /**
  * Specifies the channel placement of the sample. This is used to place mono sounds within a
  * stereo pair or for multi-track placement. Each bit position within the ulChannel field specifies
  * a channel placement with bit 0 specifying a mono sample or the left channel of a stereo file.
  */
  channel = 1;
  /**
  * Specifies the 0 based index of the cue entry in the wave pool table.
  */
  tableIndex;
  /**
  * Specifies flag options for this wave link. All bits not defined must be set to 0.
  */
  fusOptions = 0;
  /**
  * Specifies a group number for samples which are phase locked. All waves in a set of wave
  * links with the same group are phase locked and follow the wave in the group with the
  * F_WAVELINK_PHASE_MASTER flag set. If a wave is not a member of a phase locked
  * group, this value should be set to 0.
  */
  phaseGroup = 0;
  constructor(tableIndex) {
    this.tableIndex = tableIndex;
  }
  static copyFrom(waveLink) {
    const wlnk = new WaveLink2(waveLink.tableIndex);
    wlnk.channel = waveLink.channel;
    wlnk.phaseGroup = waveLink.phaseGroup;
    wlnk.fusOptions = waveLink.fusOptions;
    return wlnk;
  }
  static read(chunk) {
    const fusOptions = readLittleEndianIndexed(chunk.data, 2);
    const phaseGroup = readLittleEndianIndexed(chunk.data, 2);
    const ulChannel = readLittleEndianIndexed(chunk.data, 4);
    const wlnk = new WaveLink2(readLittleEndianIndexed(chunk.data, 4));
    wlnk.channel = ulChannel;
    wlnk.fusOptions = fusOptions;
    wlnk.phaseGroup = phaseGroup;
    return wlnk;
  }
  static fromSFZone(samples, zone) {
    const index = samples.indexOf(zone.sample);
    if (index === -1) throw new Error(`Wave link error: Sample ${zone.sample.name} does not exist in the sample list.`);
    const waveLink = new WaveLink2(index);
    switch (zone.sample.sampleType) {
      default:
      case sampleTypes.leftSample:
      case sampleTypes.monoSample:
        waveLink.channel = Math.trunc(1);
        break;
      case sampleTypes.rightSample:
        waveLink.channel = 2;
    }
    return waveLink;
  }
  write() {
    const wlnkData = new IndexedByteArray(12);
    writeWord(wlnkData, this.fusOptions);
    writeWord(wlnkData, this.phaseGroup);
    writeDword(wlnkData, this.channel);
    writeDword(wlnkData, this.tableIndex);
    return RIFFChunk.write("wlnk", wlnkData);
  }
};
var DownloadableSoundsRegion = class DownloadableSoundsRegion2 extends DLSVerifier {
  articulation = new DownloadableSoundsArticulation();
  /**
  * Specifies the key range for this region.
  */
  keyRange = {
    min: 0,
    max: 127
  };
  /**
  * Specifies the velocity range for this region.
  */
  velRange = {
    min: 0,
    max: 127
  };
  /**
  * Specifies the key group for a drum instrument. Key group values allow multiple regions
  * within a drum instrument to belong to the same "key group." If a synthesis engine is
  * instructed to play a note with a key group setting and any other notes are currently playing
  * with this same key group, then the synthesis engine should turn off all notes with the same
  * key group value as soon as possible.
  */
  keyGroup = 0;
  /**
  * Specifies flag options for the synthesis of this region.
  */
  fusOptions = 0;
  /**
  * Indicates the layer of this region for editing purposes. This field facilitates the
  * organization of overlapping regions into layers for display to the user of a DLS sound editor.
  * For example, if a piano sound and a string section are overlapped to create a piano/string pad,
  * all the regions of the piano might be labeled as layer 1, and all the regions of the string
  * section might be labeled as layer 2
  */
  usLayer = 0;
  waveSample;
  waveLink;
  constructor(waveLink, waveSample) {
    super();
    this.waveSample = waveSample;
    this.waveLink = waveLink;
  }
  static copyFrom(inputRegion) {
    const outputRegion = new DownloadableSoundsRegion2(WaveLink.copyFrom(inputRegion.waveLink), WaveSample.copyFrom(inputRegion.waveSample));
    outputRegion.keyGroup = inputRegion.keyGroup;
    outputRegion.keyRange = { ...inputRegion.keyRange };
    outputRegion.velRange = { ...inputRegion.velRange };
    outputRegion.usLayer = inputRegion.usLayer;
    outputRegion.fusOptions = inputRegion.fusOptions;
    outputRegion.articulation.copyFrom(inputRegion.articulation);
    return outputRegion;
  }
  static read(samples, chunk) {
    const regionChunks = this.verifyAndReadList(chunk, "rgn ", "rgn2");
    const waveSampleChunk = regionChunks.find((c) => c.header === "wsmp");
    let waveSample = waveSampleChunk ? WaveSample.read(waveSampleChunk) : void 0;
    const waveLinkChunk = regionChunks.find((c) => c.header === "wlnk");
    if (!waveLinkChunk) {
      SpessaSynthWarn("Invalid DLS region: missing 'wlnk' chunk! Discarding...");
      return;
    }
    const waveLink = WaveLink.read(waveLinkChunk);
    const regionHeader = regionChunks.find((c) => c.header === "rgnh");
    if (!regionHeader) {
      SpessaSynthWarn("Invalid DLS region: missing 'rgnh' chunk! Discarding...");
      return;
    }
    const sample = samples[waveLink.tableIndex];
    if (!sample) DownloadableSoundsRegion2.parsingError(`Invalid sample index: ${waveLink.tableIndex}. Samples available: ${samples.length}`);
    waveSample ??= sample.waveSample;
    const region = new DownloadableSoundsRegion2(waveLink, waveSample);
    const keyMin = readLittleEndianIndexed(regionHeader.data, 2);
    const keyMax = readLittleEndianIndexed(regionHeader.data, 2);
    let velMin = readLittleEndianIndexed(regionHeader.data, 2);
    let velMax = readLittleEndianIndexed(regionHeader.data, 2);
    if (velMin === 0 && velMax === 0) {
      velMax = 127;
      velMin = 0;
    }
    region.keyRange.max = keyMax;
    region.keyRange.min = keyMin;
    region.velRange.max = velMax;
    region.velRange.min = velMin;
    region.fusOptions = readLittleEndianIndexed(regionHeader.data, 2);
    region.keyGroup = readLittleEndianIndexed(regionHeader.data, 2);
    if (regionHeader.data.length - regionHeader.data.currentIndex >= 2) region.usLayer = readLittleEndianIndexed(regionHeader.data, 2);
    region.articulation.read(regionChunks);
    return region;
  }
  static fromSFZone(zone, samples) {
    const waveSample = WaveSample.fromSFZone(zone);
    const region = new DownloadableSoundsRegion2(WaveLink.fromSFZone(samples, zone), waveSample);
    region.keyRange.min = Math.max(zone.keyRange.min, 0);
    region.keyRange.max = zone.keyRange.max;
    region.velRange.min = Math.max(zone.velRange.min, 0);
    region.velRange.max = zone.velRange.max;
    region.keyGroup = zone.getGenerator(generatorTypes.exclusiveClass, 0);
    region.articulation.fromSFZone(zone);
    return region;
  }
  write() {
    const chunks = [
      this.writeHeader(),
      this.waveSample.write(),
      this.waveLink.write(),
      this.articulation.write()
    ];
    return RIFFChunk.writeParts("rgn2", chunks, true);
  }
  toSFZone(instrument, samples) {
    const sample = samples[this.waveLink.tableIndex];
    if (!sample) DownloadableSoundsRegion2.parsingError(`Invalid sample index: ${this.waveLink.tableIndex}`);
    const zone = instrument.createZone(sample);
    zone.keyRange = this.keyRange;
    zone.velRange = this.velRange;
    if (this.keyRange.max === 127 && this.keyRange.min === 0) zone.keyRange.min = -1;
    if (this.velRange.max === 127 && this.velRange.min === 0) zone.velRange.min = -1;
    if (this.keyGroup !== 0) zone.setGenerator(generatorTypes.exclusiveClass, this.keyGroup);
    this.waveSample.toSFZone(zone, sample);
    this.articulation.toSFZone(zone);
    zone.generators = zone.generators.filter((g) => g.generatorValue !== generatorLimits[g.generatorType].def);
    return zone;
  }
  writeHeader() {
    const rgnhData = new IndexedByteArray(14);
    writeWord(rgnhData, Math.max(this.keyRange.min, 0));
    writeWord(rgnhData, this.keyRange.max);
    writeWord(rgnhData, Math.max(this.velRange.min, 0));
    writeWord(rgnhData, this.velRange.max);
    writeWord(rgnhData, this.fusOptions);
    writeWord(rgnhData, this.keyGroup);
    writeWord(rgnhData, this.usLayer);
    return RIFFChunk.write("rgnh", rgnhData);
  }
};
var DownloadableSoundsInstrument = class DownloadableSoundsInstrument2 extends DLSVerifier {
  articulation = new DownloadableSoundsArticulation();
  regions = new Array();
  name = "Unnamed";
  bankLSB = 0;
  bankMSB = 0;
  isGMGSDrum = false;
  program = 0;
  static copyFrom(inputInstrument) {
    const outputInstrument = new DownloadableSoundsInstrument2();
    outputInstrument.name = inputInstrument.name;
    outputInstrument.isGMGSDrum = inputInstrument.isGMGSDrum;
    outputInstrument.bankMSB = inputInstrument.bankMSB;
    outputInstrument.bankLSB = inputInstrument.bankLSB;
    outputInstrument.program = inputInstrument.program;
    outputInstrument.articulation.copyFrom(inputInstrument.articulation);
    for (const region of inputInstrument.regions) outputInstrument.regions.push(DownloadableSoundsRegion.copyFrom(region));
    return outputInstrument;
  }
  static read(samples, chunk) {
    const chunks = this.verifyAndReadList(chunk, "ins ");
    const instrumentHeader = chunks.find((c) => c.header === "insh");
    if (!instrumentHeader) {
      SpessaSynthGroupEnd();
      throw new Error("No instrument header!");
    }
    let instrumentName = ``;
    const infoChunk = RIFFChunk.findListType(chunks, "INFO");
    if (infoChunk) {
      let info = RIFFChunk.read(infoChunk.data);
      while (info.header !== "INAM") info = RIFFChunk.read(infoChunk.data);
      instrumentName = readBinaryStringIndexed(info.data, info.data.length).trim();
    }
    if (instrumentName.length === 0) instrumentName = `Unnamed Instrument`;
    const instrument = new DownloadableSoundsInstrument2();
    instrument.name = instrumentName;
    const regions = readLittleEndianIndexed(instrumentHeader.data, 4);
    const ulBank = readLittleEndianIndexed(instrumentHeader.data, 4);
    instrument.program = readLittleEndianIndexed(instrumentHeader.data, 4) & 127;
    instrument.bankMSB = ulBank >>> 8 & 127;
    instrument.bankLSB = ulBank & 127;
    instrument.isGMGSDrum = ulBank >>> 31 > 0;
    SpessaSynthGroupCollapsed(`%cParsing %c"${instrumentName}"%c...`, consoleColors.info, consoleColors.recognized, consoleColors.info);
    const regionListChunk = RIFFChunk.findListType(chunks, "lrgn");
    if (!regionListChunk) {
      SpessaSynthGroupEnd();
      throw new Error("No region list!");
    }
    instrument.articulation.read(chunks);
    for (let i = 0; i < regions; i++) {
      const chunk2 = RIFFChunk.read(regionListChunk.data);
      this.verifyHeader(chunk2, "LIST");
      const type = readBinaryStringIndexed(chunk2.data, 4);
      if (type !== "rgn " && type !== "rgn2") {
        SpessaSynthGroupEnd();
        this.parsingError(`Invalid DLS region! Expected "rgn " or "rgn2" got "${type}"`);
      }
      const region = DownloadableSoundsRegion.read(samples, chunk2);
      if (region) instrument.regions.push(region);
    }
    SpessaSynthGroupEnd();
    return instrument;
  }
  static fromSFPreset(preset, samples) {
    const instrument = new DownloadableSoundsInstrument2();
    instrument.name = preset.name;
    instrument.bankLSB = preset.bankLSB;
    instrument.bankMSB = preset.bankMSB;
    instrument.program = preset.program;
    instrument.isGMGSDrum = preset.isGMGSDrum;
    SpessaSynthGroup(`%cConverting %c${preset.toString()}%c to DLS...`, consoleColors.info, consoleColors.value, consoleColors.info);
    const inst = preset.toFlattenedInstrument();
    for (const z of inst.zones) instrument.regions.push(DownloadableSoundsRegion.fromSFZone(z, samples));
    SpessaSynthGroupEnd();
    return instrument;
  }
  write() {
    SpessaSynthGroupCollapsed(`%cWriting %c${this.name}%c...`, consoleColors.info, consoleColors.recognized, consoleColors.info);
    const chunks = [this.writeHeader()];
    const regionChunks = this.regions.map((r) => r.write());
    chunks.push(RIFFChunk.writeParts("lrgn", regionChunks, true));
    if (this.articulation.length > 0) chunks.push(this.articulation.write());
    const inam = RIFFChunk.write("INAM", getStringBytes(this.name, true));
    chunks.push(RIFFChunk.write("INFO", inam, false, true));
    SpessaSynthGroupEnd();
    return RIFFChunk.writeParts("ins ", chunks, true);
  }
  /**
  * Performs the full DLS to SF2 instrument conversion.
  */
  toSFPreset(soundBank) {
    const preset = new BasicPreset(soundBank);
    preset.name = this.name;
    preset.bankMSB = this.bankMSB;
    preset.bankLSB = this.bankLSB;
    preset.isGMGSDrum = this.isGMGSDrum;
    preset.program = this.program;
    const instrument = new BasicInstrument();
    instrument.name = this.name;
    preset.createZone(instrument);
    this.articulation.toSFZone(instrument.globalZone);
    for (const region of this.regions) region.toSFZone(instrument, soundBank.samples);
    instrument.globalize();
    if (!instrument.globalZone.modulators.some((m) => m.destination === generatorTypes.reverbEffectsSend)) instrument.globalZone.addModulators(Modulator.copyFrom(DEFAULT_DLS_REVERB));
    if (!instrument.globalZone.modulators.some((m) => m.destination === generatorTypes.chorusEffectsSend)) instrument.globalZone.addModulators(Modulator.copyFrom(DEFAULT_DLS_CHORUS));
    instrument.globalZone.generators = instrument.globalZone.generators.filter((g) => g.generatorValue !== generatorLimits[g.generatorType].def);
    soundBank.addPresets(preset);
    soundBank.addInstruments(instrument);
  }
  writeHeader() {
    const inshData = new IndexedByteArray(12);
    writeDword(inshData, this.regions.length);
    let ulBank = (this.bankMSB & 127) << 8 | this.bankLSB & 127;
    if (this.isGMGSDrum) ulBank |= 1 << 31;
    writeDword(inshData, ulBank);
    writeDword(inshData, this.program & 127);
    return RIFFChunk.write("insh", inshData);
  }
};
var DEFAULT_DLS_OPTIONS = { progressFunction: void 0 };
var DownloadableSounds = class DownloadableSounds2 extends DLSVerifier {
  samples = new Array();
  instruments = new Array();
  soundBankInfo = {
    name: "Unnamed DLS sound bank",
    creationDate: /* @__PURE__ */ new Date(),
    software: "SpessaSynth",
    soundEngine: "DLS Level 2.2",
    product: "SpessaSynth DLS",
    version: {
      major: 2,
      minor: 4
    }
  };
  static read(buffer) {
    if (!buffer) throw new Error("No data provided!");
    const dataArray = new IndexedByteArray(buffer);
    SpessaSynthGroup("%cParsing DLS file...", consoleColors.info);
    const firstChunk = RIFFChunk.read(dataArray, false);
    this.verifyHeader(firstChunk, "RIFF");
    this.verifyText(readBinaryStringIndexed(dataArray, 4).toLowerCase(), "dls ");
    const chunks = [];
    while (dataArray.currentIndex < dataArray.length) chunks.push(RIFFChunk.read(dataArray));
    const dls = new DownloadableSounds2();
    const infoChunk = RIFFChunk.findListType(chunks, "INFO");
    if (infoChunk) while (infoChunk.data.currentIndex < infoChunk.data.length) {
      const infoPart = RIFFChunk.read(infoChunk.data);
      const headerTyped = infoPart.header;
      const text = readBinaryStringIndexed(infoPart.data, infoPart.size);
      switch (headerTyped) {
        case "INAM":
          dls.soundBankInfo.name = text;
          break;
        case "ICRD":
          dls.soundBankInfo.creationDate = parseDateString(text);
          break;
        case "ICMT":
          dls.soundBankInfo.comment = text;
          break;
        case "ISBJ":
          dls.soundBankInfo.subject = text;
          break;
        case "ICOP":
          dls.soundBankInfo.copyright = text;
          break;
        case "IENG":
          dls.soundBankInfo.engineer = text;
          break;
        case "IPRD":
          dls.soundBankInfo.product = text;
          break;
        case "ISFT":
          dls.soundBankInfo.software = text;
      }
    }
    this.printInfo(dls);
    const colhChunk = chunks.find((c) => c.header === "colh");
    if (!colhChunk) {
      this.parsingError("No colh chunk!");
      return 5;
    }
    const instrumentAmount = readLittleEndianIndexed(colhChunk.data, 4);
    SpessaSynthInfo(`%cInstruments amount: %c${instrumentAmount}`, consoleColors.info, consoleColors.recognized);
    const waveListChunk = RIFFChunk.findListType(chunks, "wvpl");
    if (!waveListChunk) {
      this.parsingError("No wvpl chunk!");
      return 5;
    }
    const waveList = this.verifyAndReadList(waveListChunk, "wvpl");
    for (const wave of waveList) dls.samples.push(DownloadableSoundsSample.read(wave));
    const instrumentListChunk = RIFFChunk.findListType(chunks, "lins");
    if (!instrumentListChunk) {
      this.parsingError("No lins chunk!");
      return 5;
    }
    const instruments = this.verifyAndReadList(instrumentListChunk, "lins");
    SpessaSynthGroupCollapsed("%cLoading instruments...", consoleColors.info);
    if (instruments.length !== instrumentAmount) SpessaSynthWarn(`Colh reported invalid amount of instruments. Detected ${instruments.length}, expected ${instrumentAmount}`);
    for (const ins of instruments) dls.instruments.push(DownloadableSoundsInstrument.read(dls.samples, ins));
    SpessaSynthGroupEnd();
    const aliasingChunk = chunks.find((c) => c.header === "pgal");
    if (aliasingChunk) {
      SpessaSynthInfo("%cFound the instrument aliasing chunk!", consoleColors.recognized);
      const pgalData = aliasingChunk.data;
      if (pgalData[0] !== 0 || pgalData[1] !== 1 || pgalData[2] !== 2 || pgalData[3] !== 3) pgalData.currentIndex += 4;
      const drumInstrument = dls.instruments.find((i) => BankSelectHacks.isXGDrums(i.bankMSB) || i.isGMGSDrum);
      if (!drumInstrument) {
        SpessaSynthWarn("MobileBAE aliasing chunk without a drum preset. Aborting!");
        return dls;
      }
      const drumAliases = pgalData.slice(pgalData.currentIndex, pgalData.currentIndex + 128);
      pgalData.currentIndex += 128;
      for (let keyNum = 0; keyNum < 128; keyNum++) {
        const alias = drumAliases[keyNum];
        if (alias === keyNum) continue;
        const region = drumInstrument.regions.find((r) => r.keyRange.max === alias && r.keyRange.min === alias);
        if (!region) {
          SpessaSynthWarn(`Invalid drum alias ${keyNum} to ${alias}: region does not exist.`);
          continue;
        }
        const copied = DownloadableSoundsRegion.copyFrom(region);
        copied.keyRange.max = keyNum;
        copied.keyRange.min = keyNum;
        drumInstrument.regions.push(copied);
      }
      pgalData.currentIndex += 4;
      while (pgalData.currentIndex < pgalData.length) {
        const aliasBankNum = readLittleEndianIndexed(pgalData, 2);
        const aliasBankLSB = aliasBankNum & 127;
        const aliasBankMSB = aliasBankNum >> 7 & 127;
        const aliasProgram = pgalData[pgalData.currentIndex++];
        let nullByte = pgalData[pgalData.currentIndex++];
        if (nullByte !== 0) SpessaSynthWarn(`Invalid alias byte. Expected 0, got ${nullByte}`);
        const inputBankNum = readLittleEndianIndexed(pgalData, 2);
        const inputBankLSB = inputBankNum & 127;
        const inputBankMSB = inputBankNum >> 7 & 127;
        const inputProgram = pgalData[pgalData.currentIndex++];
        nullByte = pgalData[pgalData.currentIndex++];
        if (nullByte !== 0) SpessaSynthWarn(`Invalid alias header. Expected 0, got ${nullByte}`);
        const inputInstrument = dls.instruments.find((inst) => inst.bankLSB === inputBankLSB && inst.bankMSB === inputBankMSB && inst.program === inputProgram && !inst.isGMGSDrum);
        if (!inputInstrument) {
          SpessaSynthWarn(`Invalid alias. Missing instrument: ${inputBankLSB}:${inputBankMSB}:${inputProgram}`);
          continue;
        }
        const alias = DownloadableSoundsInstrument.copyFrom(inputInstrument);
        alias.bankMSB = aliasBankMSB;
        alias.bankLSB = aliasBankLSB;
        alias.program = aliasProgram;
        dls.instruments.push(alias);
      }
    }
    SpessaSynthInfo(`%cParsing finished! %c"${dls.soundBankInfo.name || "UNNAMED"}"%c has %c${dls.instruments.length}%c instruments and %c${dls.samples.length}%c samples.`, consoleColors.info, consoleColors.recognized, consoleColors.info, consoleColors.recognized, consoleColors.info, consoleColors.recognized, consoleColors.info);
    SpessaSynthGroupEnd();
    return dls;
  }
  /**
  * Performs a full conversion from BasicSoundBank to DownloadableSounds.
  */
  static fromSF(bank) {
    SpessaSynthGroupCollapsed("%cSaving SF2 to DLS level 2...", consoleColors.info);
    const dls = new DownloadableSounds2();
    dls.soundBankInfo = { ...bank.soundBankInfo };
    for (const s of bank.samples) dls.samples.push(DownloadableSoundsSample.fromSFSample(s));
    for (const p of bank.presets) dls.instruments.push(DownloadableSoundsInstrument.fromSFPreset(p, bank.samples));
    SpessaSynthInfo("%cConversion complete!", consoleColors.recognized);
    SpessaSynthGroupEnd();
    return dls;
  }
  static printInfo(dls) {
    for (const [info, value] of Object.entries(dls.soundBankInfo)) if (typeof value === "object" && "major" in value) {
      const v = value;
      SpessaSynthInfo(`%c${info}: %c"${v.major}.${v.minor}"`, consoleColors.info, consoleColors.recognized);
    } else SpessaSynthInfo(`%c${info}: %c${value.toLocaleString()}`, consoleColors.info, consoleColors.recognized);
  }
  /**
  * Writes a DLS file
  * @param options
  */
  async write(options = DEFAULT_DLS_OPTIONS) {
    SpessaSynthGroupCollapsed("%cSaving DLS...", consoleColors.info);
    const colhNum = new IndexedByteArray(4);
    writeDword(colhNum, this.instruments.length);
    const colh = RIFFChunk.write("colh", colhNum);
    SpessaSynthGroupCollapsed("%cWriting instruments...", consoleColors.info);
    const lins = RIFFChunk.writeParts("lins", this.instruments.map((i) => i.write()), true);
    SpessaSynthInfo("%cSuccess!", consoleColors.recognized);
    SpessaSynthGroupEnd();
    SpessaSynthGroupCollapsed("%cWriting WAVE samples...", consoleColors.info);
    let currentIndex = 0;
    const ptblOffsets = [];
    const samples = [];
    let written = 0;
    for (const s of this.samples) {
      const out2 = s.write();
      await options?.progressFunction?.(s.name, written, this.samples.length);
      ptblOffsets.push(currentIndex);
      currentIndex += out2.length;
      samples.push(out2);
      written++;
    }
    const wvpl = RIFFChunk.writeParts("wvpl", samples, true);
    SpessaSynthInfo("%cSucceeded!", consoleColors.recognized);
    const ptblData = new IndexedByteArray(8 + 4 * ptblOffsets.length);
    writeDword(ptblData, 8);
    writeDword(ptblData, ptblOffsets.length);
    for (const offset of ptblOffsets) writeDword(ptblData, offset);
    const ptbl = RIFFChunk.write("ptbl", ptblData);
    this.soundBankInfo.software = "SpessaSynth";
    const infos = [];
    const info = this.soundBankInfo;
    const writeDLSInfo = (type, data) => {
      if (!data) return;
      infos.push(RIFFChunk.write(type, getStringBytes(data, true)));
    };
    writeDLSInfo("INAM", info.name);
    writeDLSInfo("ICMT", info.comment);
    writeDLSInfo("ICOP", info.copyright);
    writeDLSInfo("ICRD", toISODateString(info.creationDate));
    writeDLSInfo("IENG", info.engineer);
    writeDLSInfo("IPRD", info.product);
    writeDLSInfo("ISFT", options.software ?? "SpessaSynth");
    writeDLSInfo("ISBJ", info.subject);
    SpessaSynthInfo("%cCombining everything...");
    const out = RIFFChunk.writeParts("RIFF", [
      getStringBytes("DLS "),
      colh,
      lins,
      ptbl,
      wvpl,
      RIFFChunk.writeParts("INFO", infos, true)
    ]);
    SpessaSynthInfo("%cSaved successfully!", consoleColors.recognized);
    SpessaSynthGroupEnd();
    return out.buffer;
  }
  /**
  * Performs a full conversion from DownloadableSounds to BasicSoundBank.
  */
  toSF() {
    SpessaSynthGroup("%cConverting DLS to SF2...", consoleColors.info);
    const soundBank = new BasicSoundBank();
    soundBank.soundBankInfo.version.minor = 4;
    soundBank.soundBankInfo.version.major = 2;
    soundBank.soundBankInfo = { ...this.soundBankInfo };
    for (const sample of this.samples) sample.toSFSample(soundBank);
    for (const instrument of this.instruments) instrument.toSFPreset(soundBank);
    soundBank.flush();
    SpessaSynthInfo("%cConversion complete!", consoleColors.recognized);
    SpessaSynthGroupEnd();
    return soundBank;
  }
};
var BasicSoundBank = class BasicSoundBank2 {
  /**
  * Indicates if the SF3/SF2Pack decoder is ready.
  */
  static isSF3DecoderReady = stb.isInitialized;
  /**
  * Sound bank's info.
  */
  soundBankInfo = {
    name: "Unnamed",
    creationDate: /* @__PURE__ */ new Date(),
    software: "SpessaSynth",
    soundEngine: "E-mu 10K2",
    version: {
      major: 2,
      minor: 4
    }
  };
  /**
  * The sound bank's presets.
  */
  presets = [];
  /**
  * The sound bank's samples.
  */
  samples = [];
  /**
  * The sound bank's instruments.
  */
  instruments = [];
  /**
  * Sound bank's default modulators.
  */
  defaultModulators = SPESSASYNTH_DEFAULT_MODULATORS.map(Modulator.copyFrom.bind(Modulator));
  /**
  * If the sound bank has custom default modulators (DMOD).
  */
  customDefaultModulators = false;
  _isXGBank = false;
  /**
  * Checks for XG drum sets and considers if this sound bank is XG.
  */
  get isXGBank() {
    return this._isXGBank;
  }
  /**
  * Merges sound banks with the given order. Keep in mind that the info read is copied from the first one
  * @param soundBanks the sound banks to merge, the first overwrites the last
  */
  static mergeSoundBanks(...soundBanks) {
    const mainSf = soundBanks.shift();
    if (!mainSf) throw new Error("No sound banks provided!");
    const presets = mainSf.presets;
    while (soundBanks.length > 0) {
      const newPresets = soundBanks?.shift()?.presets;
      if (newPresets) {
        for (const newPreset of newPresets) if (!presets.some((existingPreset) => newPreset.matches(existingPreset))) presets.push(newPreset);
      }
    }
    const b = new BasicSoundBank2();
    b.addCompletePresets(presets);
    b.soundBankInfo = { ...mainSf.soundBankInfo };
    return b;
  }
  /**
  * Creates a simple sound bank with one saw wave preset.
  */
  static async getSampleSoundBankFile() {
    const font = new BasicSoundBank2();
    const sampleData = new Float32Array(128);
    for (let i = 0; i < 128; i++) sampleData[i] = i / 128 * 2 - 1;
    const sample = new EmptySample();
    sample.name = "Saw";
    sample.originalKey = 65;
    sample.pitchCorrection = 20;
    sample.loopEnd = 127;
    sample.setAudioData(sampleData, 44100);
    font.addSamples(sample);
    const inst = new BasicInstrument();
    inst.name = "Saw Wave";
    inst.globalZone.addGenerators(new Generator(generatorTypes.initialAttenuation, 375), new Generator(generatorTypes.releaseVolEnv, -1e3), new Generator(generatorTypes.sampleModes, 1));
    inst.createZone(sample);
    inst.createZone(sample).setGenerator(generatorTypes.fineTune, -9);
    font.addInstruments(inst);
    const preset = new BasicPreset(font);
    preset.name = "Saw Wave";
    preset.createZone(inst);
    font.addPresets(preset);
    font.soundBankInfo.name = "Dummy";
    font.flush();
    return await font.writeSF2();
  }
  /**
  * Copies a given sound bank.
  * @param bank The sound bank to copy.
  */
  static copyFrom(bank) {
    const copied = new BasicSoundBank2();
    for (const p of bank.presets) copied.clonePreset(p);
    copied.soundBankInfo = { ...bank.soundBankInfo };
    return copied;
  }
  /**
  * Adds complete presets along with their instruments and samples.
  * @param presets The presets to add.
  */
  addCompletePresets(presets) {
    this.addPresets(...presets);
    const instrumentList = [];
    for (const preset of presets) for (const zone of preset.zones) if (zone.instrument && !instrumentList.includes(zone.instrument)) instrumentList.push(zone.instrument);
    this.addInstruments(...instrumentList);
    const sampleList = [];
    for (const instrument of instrumentList) for (const zone of instrument.zones) if (zone.sample && !sampleList.includes(zone.sample)) sampleList.push(zone.sample);
    this.addSamples(...sampleList);
  }
  /**
  * Write the sound bank as a .dls file. This may not be 100% accurate.
  * @param options - options for writing the file.
  * @returns the binary file.
  */
  async writeDLS(options = DEFAULT_DLS_OPTIONS) {
    return DownloadableSounds.fromSF(this).write(options);
  }
  /**
  * Writes the sound bank as an SF2 file.
  * @param writeOptions the options for writing.
  * @returns the binary file data.
  */
  async writeSF2(writeOptions = DEFAULT_SF2_WRITE_OPTIONS) {
    return writeSF2Internal(this, writeOptions);
  }
  addPresets(...presets) {
    this.presets.push(...presets);
  }
  addInstruments(...instruments) {
    this.instruments.push(...instruments);
  }
  addSamples(...samples) {
    this.samples.push(...samples);
  }
  /**
  * Clones a sample into this bank.
  * @param sample The sample to copy.
  * @returns the copied sample, if a sample exists with that name, it is returned instead
  */
  cloneSample(sample) {
    const duplicate = this.samples.find((s) => s.name === sample.name);
    if (duplicate) return duplicate;
    const newSample = new BasicSample(sample.name, sample.sampleRate, sample.originalKey, sample.pitchCorrection, sample.sampleType, sample.loopStart, sample.loopEnd);
    if (sample.isCompressed) newSample.setCompressedData(sample.getRawData(true));
    else newSample.setAudioData(sample.getAudioData(), sample.sampleRate);
    this.addSamples(newSample);
    if (sample.linkedSample) {
      const clonedLinked = this.cloneSample(sample.linkedSample);
      if (!clonedLinked.linkedSample) newSample.setLinkedSample(clonedLinked, newSample.sampleType);
    }
    return newSample;
  }
  /**
  * Recursively clones an instrument into this sound bank, as well as its samples.
  * @returns the copied instrument, if an instrument exists with that name, it is returned instead.
  */
  cloneInstrument(instrument) {
    const duplicate = this.instruments.find((i) => i.name === instrument.name);
    if (duplicate) return duplicate;
    const newInstrument = new BasicInstrument();
    newInstrument.name = instrument.name;
    newInstrument.globalZone.copyFrom(instrument.globalZone);
    for (const zone of instrument.zones) newInstrument.createZone(this.cloneSample(zone.sample)).copyFrom(zone);
    this.addInstruments(newInstrument);
    return newInstrument;
  }
  /**
  * Recursively clones a preset into this sound bank, as well as its instruments and samples.
  * @returns the copied preset, if a preset exists with that name, it is returned instead.
  */
  clonePreset(preset) {
    const duplicate = this.presets.find((p) => p.name === preset.name);
    if (duplicate) return duplicate;
    const newPreset = new BasicPreset(this);
    newPreset.name = preset.name;
    newPreset.bankMSB = preset.bankMSB;
    newPreset.bankLSB = preset.bankLSB;
    newPreset.isGMGSDrum = preset.isGMGSDrum;
    newPreset.program = preset.program;
    newPreset.library = preset.library;
    newPreset.genre = preset.genre;
    newPreset.morphology = preset.morphology;
    newPreset.globalZone.copyFrom(preset.globalZone);
    for (const zone of preset.zones) newPreset.createZone(this.cloneInstrument(zone.instrument)).copyFrom(zone);
    this.addPresets(newPreset);
    return newPreset;
  }
  /**
  * Updates internal values.
  */
  flush() {
    this.presets.sort(MIDIPatchTools.sorter.bind(MIDIPatchTools));
    this.parseInternal();
  }
  /**
  * Trims a sound bank to only contain samples in a given MIDI file.
  * @param mid - the MIDI file
  */
  trimSoundBank(mid) {
    const trimInstrumentZones = (instrument, combos) => {
      let trimmedIZones = 0;
      for (let iZoneIndex = 0; iZoneIndex < instrument.zones.length; iZoneIndex++) {
        const iZone = instrument.zones[iZoneIndex];
        const iKeyRange = iZone.keyRange;
        const iVelRange = iZone.velRange;
        let isIZoneUsed = false;
        for (const iCombo of combos) if (iCombo.key >= iKeyRange.min && iCombo.key <= iKeyRange.max && iCombo.velocity >= iVelRange.min && iCombo.velocity <= iVelRange.max) {
          isIZoneUsed = true;
          break;
        }
        if (!isIZoneUsed && iZone.sample) {
          SpessaSynthInfo(`%c${iZone.sample.name}%c removed from %c${instrument.name}%c.`, consoleColors.recognized, consoleColors.info, consoleColors.recognized, consoleColors.info);
          if (instrument.deleteZone(iZoneIndex)) {
            trimmedIZones++;
            iZoneIndex--;
            SpessaSynthInfo(`%c${iZone.sample.name}%c deleted`, consoleColors.recognized, consoleColors.info);
          }
          if (iZone.sample.useCount < 1) this.deleteSample(iZone.sample);
        }
      }
      return trimmedIZones;
    };
    SpessaSynthGroup("%cTrimming sound bank...", consoleColors.info);
    const usedProgramsAndKeys = mid.getUsedProgramsAndKeys(this);
    SpessaSynthGroupCollapsed("%cModifying sound bank...", consoleColors.info);
    SpessaSynthInfo("Detected keys for midi:", usedProgramsAndKeys);
    for (let presetIndex = 0; presetIndex < this.presets.length; presetIndex++) {
      const p = this.presets[presetIndex];
      const used = usedProgramsAndKeys.get(p);
      if (used === void 0) {
        SpessaSynthInfo(`%cDeleting preset %c${p.name}%c and its zones`, consoleColors.info, consoleColors.recognized, consoleColors.info);
        this.deletePreset(p);
        presetIndex--;
      } else {
        const combos = [...used].map((s) => {
          const split = s.split("-");
          return {
            key: Number.parseInt(split[0]),
            velocity: Number.parseInt(split[1])
          };
        });
        SpessaSynthGroupCollapsed(`%cTrimming %c${p.name}`, consoleColors.info, consoleColors.recognized);
        SpessaSynthInfo(`Keys for ${p.name}:`, combos);
        let trimmedZones = 0;
        for (let zoneIndex = 0; zoneIndex < p.zones.length; zoneIndex++) {
          const zone = p.zones[zoneIndex];
          const keyRange = zone.keyRange;
          const velRange = zone.velRange;
          let isZoneUsed = false;
          for (const combo of combos) if (combo.key >= keyRange.min && combo.key <= keyRange.max && combo.velocity >= velRange.min && combo.velocity <= velRange.max && zone.instrument) {
            isZoneUsed = true;
            SpessaSynthInfo(`%cTrimmed off %c${trimInstrumentZones(zone.instrument, combos)}%c zones from %c${zone.instrument.name}`, consoleColors.info, consoleColors.recognized, consoleColors.info, consoleColors.recognized);
            break;
          }
          if (!isZoneUsed && zone.instrument) {
            trimmedZones++;
            p.deleteZone(zoneIndex);
            if (zone.instrument.useCount < 1) this.deleteInstrument(zone.instrument);
            zoneIndex--;
          }
        }
        SpessaSynthInfo(`%cTrimmed off %c${trimmedZones}%c zones from %c${p.name}`, consoleColors.info, consoleColors.recognized, consoleColors.info, consoleColors.recognized);
        SpessaSynthGroupEnd();
      }
    }
    this.removeUnusedElements();
    SpessaSynthInfo("%cSound bank modified!", consoleColors.recognized);
    SpessaSynthGroupEnd();
    SpessaSynthGroupEnd();
  }
  removeUnusedElements() {
    this.instruments = this.instruments.filter((i) => {
      i.deleteUnusedZones();
      const deletable = i.useCount < 1;
      if (deletable) i.delete();
      return !deletable;
    });
    this.samples = this.samples.filter((s) => {
      const deletable = s.useCount < 1;
      if (deletable) s.unlinkSample();
      return !deletable;
    });
  }
  deleteInstrument(instrument) {
    instrument.delete();
    this.instruments.splice(this.instruments.indexOf(instrument), 1);
  }
  deletePreset(preset) {
    preset.delete();
    this.presets.splice(this.presets.indexOf(preset), 1);
  }
  deleteSample(sample) {
    sample.unlinkSample();
    this.samples.splice(this.samples.indexOf(sample), 1);
  }
  /**
  * Get the appropriate preset.
  */
  getPreset(patch, system) {
    return selectPreset(this.presets, patch, system);
  }
  destroySoundBank() {
    this.presets.length = 0;
    this.instruments.length = 0;
    this.samples.length = 0;
  }
  parsingError(error) {
    throw new Error(`SF parsing error: ${error} The file may be corrupted.`);
  }
  /**
  * Parses the bank after loading is done
  * @protected
  */
  parseInternal() {
    this._isXGBank = false;
    const allowedPrograms = /* @__PURE__ */ new Set([
      0,
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      16,
      17,
      24,
      25,
      26,
      27,
      28,
      29,
      30,
      31,
      32,
      33,
      40,
      41,
      48,
      56,
      57,
      58,
      64,
      65,
      66,
      126,
      127
    ]);
    for (const preset of this.presets) if (BankSelectHacks.isXGDrums(preset.bankMSB)) {
      this._isXGBank = true;
      if (!allowedPrograms.has(preset.program)) {
        this._isXGBank = false;
        SpessaSynthInfo(`%cThis bank is not valid XG. Preset %c${preset.toString()}%c is not a valid XG drum. XG mode will use presets on bank 128.`, consoleColors.info, consoleColors.value, consoleColors.info);
        break;
      }
    }
  }
  printInfo() {
    for (const [info, value] of Object.entries(this.soundBankInfo)) if (typeof value === "object" && "major" in value) {
      const v = value;
      SpessaSynthInfo(`%c${info}: %c"${v.major}.${v.minor}"`, consoleColors.info, consoleColors.recognized);
    } else SpessaSynthInfo(`%c${info}: %c${value.toLocaleString()}`, consoleColors.info, consoleColors.recognized);
  }
};
var VoiceModulator = class VoiceModulator2 extends Modulator {
  /**
  * Indicates if the given modulator is chorus or reverb effects modulator.
  * This is done to simulate BASSMIDI effects behavior:
  * - defaults to 1000 transform amount rather than 200
  * - values can be changed, but anything above 200 is 1000
  * (except for values above 1000, they are copied directly)
  * - all values below are multiplied by 5 (200 * 5 = 1000)
  * - still can be disabled if the soundfont has its own modulator curve
  * - this fixes the very low amount of reverb by default and doesn't break soundfonts
  */
  isEffectModulator;
  /**
  * The default resonant modulator does not affect the filter gain.
  * Neither XG nor GS responded to cc #74 in that way.
  */
  isDefaultResonantModulator;
  /**
  * If this is a modulation wheel modulator (for modulation depth range).
  */
  isModWheelModulator;
  constructor(s1, s2, destination, amount, transformType, isEffectModulator, isDefaultResonantModulator, isModWheelModulator) {
    super(s1, s2, destination, amount, transformType);
    this.isEffectModulator = isEffectModulator;
    this.isDefaultResonantModulator = isDefaultResonantModulator;
    this.isModWheelModulator = isModWheelModulator;
  }
  static fromData(s1, s2, destination, amount, transformType) {
    const s1Enum = s1.toSourceEnum();
    const s2Enum = s2.toSourceEnum();
    return new VoiceModulator2(s1, s2, destination, amount, transformType, (s1Enum === 219 || s1Enum === 221) && s2Enum === 0 && (destination === generatorTypes.reverbEffectsSend || destination === generatorTypes.chorusEffectsSend), s1Enum === DEFAULT_RESONANT_MOD_SOURCE && s2Enum === 0 && destination === generatorTypes.initialFilterQ, (s1.isCC && s1.index === midiControllers.modulationWheel || s2.isCC && s2.index === midiControllers.modulationWheel) && (destination === generatorTypes.modLfoToPitch || destination === generatorTypes.vibLfoToPitch));
  }
  static fromModulator(mod) {
    return this.fromData(mod.primarySource, mod.secondarySource, mod.destination, mod.transformAmount, mod.transformType);
  }
};
var TWOPI = Math.PI * 2;
var HALF_PI$1 = Math.PI / 2;
var MIN_PAN$1 = -500;
var MAX_PAN$1 = 500;
var PAN_RESOLUTION$1 = MAX_PAN$1 - MIN_PAN$1;
var panTableLeft$1 = new Float32Array(PAN_RESOLUTION$1 + 1);
var panTableRight$1 = new Float32Array(PAN_RESOLUTION$1 + 1);
for (let pan = MIN_PAN$1; pan <= MAX_PAN$1; pan++) {
  const realPan = (pan - MIN_PAN$1) / PAN_RESOLUTION$1;
  const tableIndex = pan - MIN_PAN$1;
  panTableLeft$1[tableIndex] = Math.cos(HALF_PI$1 * realPan);
  panTableRight$1[tableIndex] = Math.sin(HALF_PI$1 * realPan);
}
var AWE_NRPN_GENERATOR_MAPPINGS = [
  generatorTypes.delayModLFO,
  generatorTypes.freqModLFO,
  generatorTypes.delayVibLFO,
  generatorTypes.freqVibLFO,
  generatorTypes.delayModEnv,
  generatorTypes.attackModEnv,
  generatorTypes.holdModEnv,
  generatorTypes.decayModEnv,
  generatorTypes.sustainModEnv,
  generatorTypes.releaseModEnv,
  generatorTypes.delayVolEnv,
  generatorTypes.attackVolEnv,
  generatorTypes.holdVolEnv,
  generatorTypes.decayVolEnv,
  generatorTypes.sustainVolEnv,
  generatorTypes.releaseVolEnv,
  generatorTypes.fineTune,
  generatorTypes.modLfoToPitch,
  generatorTypes.vibLfoToPitch,
  generatorTypes.modEnvToPitch,
  generatorTypes.modLfoToVolume,
  generatorTypes.initialFilterFc,
  generatorTypes.initialFilterQ,
  generatorTypes.modLfoToFilterFc,
  generatorTypes.modEnvToFilterFc,
  generatorTypes.chorusEffectsSend,
  generatorTypes.reverbEffectsSend
];
var INITIAL_MODULATORS = [VoiceModulator.fromModulator(new DecodedModulator(getModSourceEnum(modulatorCurveTypes.linear, true, false, true, midiControllers.vibratoRate), 0, generatorTypes.vibLfoRate, 1e3, 0))];
var EFFECT_MODULATOR_TRANSFORM_MULTIPLIER = 1e3 / 200;
var HALF_PI = Math.PI / 2;
var MIN_PAN = -64;
var MAX_PAN = 63;
var PAN_RESOLUTION = MAX_PAN - MIN_PAN;
var panTableLeft = new Float32Array(PAN_RESOLUTION + 1);
var panTableRight = new Float32Array(PAN_RESOLUTION + 1);
for (let pan = MIN_PAN; pan <= MAX_PAN; pan++) {
  const realPan = (pan - MIN_PAN) / PAN_RESOLUTION;
  const tableIndex = pan - MIN_PAN;
  panTableLeft[tableIndex] = Math.cos(HALF_PI * realPan);
  panTableRight[tableIndex] = Math.sin(HALF_PI * realPan);
}
var PI_2$1 = Math.PI * 2;
var DEPTH_MUL = 5;
var LFO_SMOOTH_FRAC = DEPTH_MUL * 0.5;
var PI_2 = Math.PI * 2;

// node_modules/spessasynth_lib/dist/index.js
var DEFAULT_SYNTH_CONFIG = {
  enableEventSystem: true,
  oneOutput: false,
  audioNodeCreators: void 0
};
var WORKLET_PROCESSOR_NAME = "spessasynth-worklet-processor";
function fillWithDefaults2(obj, defObj) {
  return {
    ...defObj,
    ...obj
  };
}
var WorkletKeyModifierManagerWrapper = class {
  keyModifiers = [];
  synth;
  constructor(synth) {
    this.synth = synth;
  }
  /**
  * Modifies a single key.
  * @param channel The channel affected. Usually 0-15.
  * @param midiNote The MIDI note to change. 0-127.
  * @param options The key's modifiers.
  */
  addModifier(channel, midiNote, options) {
    const mod = new KeyModifier();
    mod.gain = options?.gain ?? 1;
    mod.velocity = options?.velocity ?? -1;
    mod.patch = fillWithDefaults2(options.patch ?? {}, {
      isGMGSDrum: false,
      bankLSB: -1,
      bankMSB: -1,
      program: -1
    });
    this.keyModifiers[channel] ??= [];
    this.keyModifiers[channel][midiNote] = mod;
    this.sendToWorklet("addMapping", {
      channel,
      midiNote,
      mapping: mod
    });
  }
  /**
  * Gets a key modifier.
  * @param channel The channel affected. Usually 0-15.
  * @param midiNote The MIDI note to change. 0-127.
  * @returns The key modifier if it exists.
  */
  getModifier(channel, midiNote) {
    return this.keyModifiers?.[channel]?.[midiNote];
  }
  /**
  * Deletes a key modifier.
  * @param channel The channel affected. Usually 0-15.
  * @param midiNote The MIDI note to change. 0-127.
  */
  deleteModifier(channel, midiNote) {
    this.sendToWorklet("deleteMapping", {
      channel,
      midiNote
    });
    if (this.keyModifiers[channel]?.[midiNote] === void 0) return;
    this.keyModifiers[channel][midiNote] = void 0;
  }
  /**
  * Clears ALL Modifiers
  */
  clearModifiers() {
    this.sendToWorklet("clearMappings", null);
    this.keyModifiers = [];
  }
  sendToWorklet(type, data) {
    const msg = {
      type,
      data
    };
    this.synth.post({
      type: "keyModifierManager",
      channelNumber: -1,
      data: msg
    });
  }
};
var SoundBankManager = class {
  /**
  * All the sound banks, ordered from the most important to the least.
  */
  soundBankList;
  synth;
  /**
  * Creates a new instance of the sound bank manager.
  */
  constructor(synth) {
    this.soundBankList = [];
    this.synth = synth;
  }
  /**
  * The current sound bank priority order.
  * @returns The IDs of the sound banks in the current order.
  */
  get priorityOrder() {
    return this.soundBankList.map((s) => s.id);
  }
  /**
  * Rearranges the sound banks in a given order.
  * @param newList The order of sound banks, a list of identifiers, first overwrites second.
  */
  set priorityOrder(newList) {
    this.sendToWorklet("rearrangeSoundBanks", newList);
    this.soundBankList.sort((a, b) => newList.indexOf(a.id) - newList.indexOf(b.id));
  }
  /**
  * Adds a new sound bank buffer with a given ID.
  * @param soundBankBuffer The sound bank's buffer
  * @param id The sound bank's unique identifier.
  * @param bankOffset The sound bank's bank offset. Default is 0.
  */
  async addSoundBank(soundBankBuffer, id, bankOffset = 0) {
    this.sendToWorklet("addSoundBank", {
      soundBankBuffer,
      bankOffset,
      id
    }, [soundBankBuffer]);
    await this.awaitResponse();
    const found = this.soundBankList.find((s) => s.id === id);
    if (found === void 0) this.soundBankList.push({
      id,
      bankOffset
    });
    else found.bankOffset = bankOffset;
  }
  /**
  * Deletes a sound bank with the given ID.
  * @param id The sound bank to delete.
  */
  async deleteSoundBank(id) {
    if (this.soundBankList.length < 2) {
      SpessaSynthCoreUtils.SpessaSynthWarn("1 sound bank left. Aborting!");
      return;
    }
    if (!this.soundBankList.some((s) => s.id === id)) {
      SpessaSynthCoreUtils.SpessaSynthWarn(`No sound banks with id of "${id}" found. Aborting!`);
      return;
    }
    this.sendToWorklet("deleteSoundBank", id);
    this.soundBankList = this.soundBankList.filter((s) => s.id !== id);
    await this.awaitResponse();
  }
  async awaitResponse() {
    return new Promise((r) => this.synth.awaitWorkerResponse("soundBankManager", r));
  }
  sendToWorklet(type, data, transferable = []) {
    const msg = {
      type: "soundBankManager",
      channelNumber: -1,
      data: {
        type,
        data
      }
    };
    this.synth.post(msg, transferable);
  }
};
var SynthEventHandler = class {
  /**
  * The time delay before an event is called.
  * Set to 0 to disable it.
  */
  timeDelay = 0;
  /**
  * The main list of events.
  * @private
  */
  events = {
    noteOff: /* @__PURE__ */ new Map(),
    noteOn: /* @__PURE__ */ new Map(),
    pitchWheel: /* @__PURE__ */ new Map(),
    controllerChange: /* @__PURE__ */ new Map(),
    programChange: /* @__PURE__ */ new Map(),
    channelPressure: /* @__PURE__ */ new Map(),
    polyPressure: /* @__PURE__ */ new Map(),
    drumChange: /* @__PURE__ */ new Map(),
    stopAll: /* @__PURE__ */ new Map(),
    newChannel: /* @__PURE__ */ new Map(),
    muteChannel: /* @__PURE__ */ new Map(),
    presetListChange: /* @__PURE__ */ new Map(),
    allControllerReset: /* @__PURE__ */ new Map(),
    soundBankError: /* @__PURE__ */ new Map(),
    synthDisplay: /* @__PURE__ */ new Map(),
    masterParameterChange: /* @__PURE__ */ new Map(),
    channelPropertyChange: /* @__PURE__ */ new Map(),
    effectChange: /* @__PURE__ */ new Map()
  };
  /**
  * Adds a new event listener.
  * @param event The event to listen to.
  * @param id The unique identifier for the event. It can be used to overwrite existing callback with the same ID.
  * @param callback The callback for the event.
  */
  addEvent(event, id, callback) {
    this.events[event].set(id, callback);
  }
  /**
  * Removes an event listener
  * @param name The event to remove a listener from.
  * @param id The unique identifier for the event to remove.
  */
  removeEvent(name, id) {
    this.events[name].delete(id);
  }
  /**
  * Calls the given event.
  * INTERNAL USE ONLY!
  * @internal
  */
  callEventInternal(name, eventData) {
    const eventList = this.events[name];
    const callback = () => {
      for (const callback2 of eventList.values()) try {
        callback2(eventData);
      } catch (error) {
        console.error(`Error while executing an event callback for ${name}:`, error);
      }
    };
    if (this.timeDelay > 0) setTimeout(callback.bind(this), this.timeDelay * 1e3);
    else callback();
  }
};
var consoleColors2 = SpessaSynthCoreUtils.consoleColors;
var DEFAULT_SYNTH_METHOD_OPTIONS = { time: 0 };
var BasicSynthesizer = class {
  /**
  * Allows managing the sound bank list.
  */
  soundBankManager = new SoundBankManager(this);
  /**
  * Allows managing key modifications.
  */
  keyModifierManager = new WorkletKeyModifierManagerWrapper(this);
  /**
  * Allows setting up custom event listeners for the synthesizer.
  */
  eventHandler = new SynthEventHandler();
  /**
  * Synthesizer's parent AudioContext instance.
  */
  context;
  /**
  * Synth's current channel properties.
  */
  channelProperties = [];
  /**
  * The current preset list.
  */
  presetList = [];
  /**
  * INTERNAL USE ONLY!
  * @internal
  * All sequencer callbacks
  */
  sequencers = new Array();
  /**
  * Resolves when the synthesizer is ready.
  */
  isReady;
  /**
  * Legacy parameter.
  * @deprecated
  */
  reverbProcessor = void 0;
  /**
  * Legacy parameter.
  * @deprecated
  */
  chorusProcessor = void 0;
  /**
  * INTERNAL USE ONLY!
  * @internal
  */
  post;
  worklet;
  /**
  * The new channels will have their audio sent to the modulated output by this constant.
  * what does that mean?
  * e.g., if outputsAmount is 16, then channel's 16 audio data will be sent to channel 0
  */
  _outputsAmount = 16;
  /**
  * The current amount of MIDI channels the synthesizer has.
  */
  channelsAmount = this._outputsAmount;
  masterParameters = { ...DEFAULT_MASTER_PARAMETERS };
  resolveMap = /* @__PURE__ */ new Map();
  renderingProgressTracker = /* @__PURE__ */ new Map();
  /**
  * Creates a new instance of a synthesizer.
  * @param worklet The AudioWorkletNode to use.
  * @param postFunction The internal post function.
  * @param config Optional configuration for the synthesizer.
  */
  constructor(worklet, postFunction, config) {
    SpessaSynthCoreUtils.SpessaSynthInfo("%cInitializing SpessaSynth synthesizer...", consoleColors2.info);
    this.context = worklet.context;
    this.worklet = worklet;
    this.post = postFunction;
    this.isReady = new Promise((resolve) => this.awaitWorkerResponse("sf3Decoder", resolve));
    this.worklet.port.onmessage = (e) => this.handleMessage(e.data);
    for (let i = 0; i < this.channelsAmount; i++) this.addNewChannelInternal(false);
    this.channelProperties[DEFAULT_PERCUSSION].isDrum = true;
    this.eventHandler.addEvent("newChannel", `synth-new-channel-${Math.random()}`, () => {
      this.channelsAmount++;
    });
    this.eventHandler.addEvent("presetListChange", `synth-preset-list-change-${Math.random()}`, (e) => {
      this.presetList = [...e];
    });
    this.eventHandler.addEvent("masterParameterChange", `synth-master-parameter-change-${Math.random()}`, (e) => {
      this.masterParameters[e.parameter] = e.value;
    });
    this.eventHandler.addEvent("channelPropertyChange", `synth-channel-property-change-${Math.random()}`, (e) => {
      this.channelProperties[e.channel] = e.property;
      this._voicesAmount = this.channelProperties.reduce((sum, voices) => sum + voices.voicesAmount, 0);
    });
  }
  /**
  * Current voice amount
  */
  _voicesAmount = 0;
  /**
  * The current number of voices playing.
  */
  get voicesAmount() {
    return this._voicesAmount;
  }
  /**
  * The audioContext's current time.
  */
  get currentTime() {
    return this.context.currentTime;
  }
  /**
  * Connects from a given node.
  * @param destinationNode The node to connect to.
  */
  connect(destinationNode) {
    for (let i = 0; i < 17; i++) this.worklet.connect(destinationNode, i);
    return destinationNode;
  }
  /**
  * Disconnects from a given node.
  * @param destinationNode The node to disconnect from.
  */
  disconnect(destinationNode) {
    if (!destinationNode) {
      this.worklet.disconnect();
      return;
    }
    for (let i = 0; i < 17; i++) this.worklet.disconnect(destinationNode, i);
    return destinationNode;
  }
  /**
  * Sets the SpessaSynth's log level in the processor.
  * @param enableInfo Enable info (verbose)
  * @param enableWarning Enable warnings (unrecognized messages)
  * @param enableGroup Enable groups (to group a lot of logs)
  */
  setLogLevel(enableInfo, enableWarning, enableGroup) {
    this.post({
      channelNumber: ALL_CHANNELS_OR_DIFFERENT_ACTION,
      type: "setLogLevel",
      data: {
        enableInfo,
        enableWarning,
        enableGroup
      }
    });
  }
  /**
  * Gets a master parameter from the synthesizer.
  * @param type The parameter to get.
  * @returns The parameter value.
  */
  getMasterParameter(type) {
    return this.masterParameters[type];
  }
  /**
  * Sets a master parameter to a given value.
  * @param type The parameter to set.
  * @param value The value to set.
  */
  setMasterParameter(type, value) {
    this.masterParameters[type] = value;
    this.post({
      type: "setMasterParameter",
      channelNumber: ALL_CHANNELS_OR_DIFFERENT_ACTION,
      data: {
        type,
        data: value
      }
    });
  }
  /**
  * Gets a complete snapshot of the synthesizer, effects.
  */
  async getSnapshot() {
    return new Promise((resolve) => {
      this.awaitWorkerResponse("synthesizerSnapshot", (s) => {
        resolve(SynthesizerSnapshot.copyFrom(s));
      });
      this.post({
        type: "requestSynthesizerSnapshot",
        data: null,
        channelNumber: -1
      });
    });
  }
  /**
  * Adds a new channel to the synthesizer.
  */
  addNewChannel() {
    this.addNewChannelInternal(true);
  }
  /**
  * DEPRECATED, please don't use it!
  * @deprecated
  */
  setVibrato(channel, value) {
  }
  /**
  * Connects a given channel output to the given audio node.
  * Note that this output is only meant for visualization and may be silent when Insertion Effect for this channel is enabled.
  * @param targetNode The node to connect to.
  * @param channelNumber The channel number to connect to, will be rolled over if value is greater than 15.
  * @returns The target node.
  */
  connectChannel(targetNode, channelNumber) {
    this.worklet.connect(targetNode, channelNumber % 16 + 1);
    return targetNode;
  }
  /**
  * Disconnects a given channel output to the given audio node.
  * @param targetNode The node to disconnect from.
  * @param channelNumber The channel number to connect to, will be rolled over if value is greater than 15.
  */
  disconnectChannel(targetNode, channelNumber) {
    this.worklet.disconnect(targetNode, channelNumber % 16 + 1);
  }
  /**
  * Connects the individual audio outputs to the given audio nodes.
  * Note that these outputs is only meant for visualization and may be silent when Insertion Effect for this channel is enabled.
  * @param audioNodes Exactly 16 outputs.
  */
  connectIndividualOutputs(audioNodes) {
    if (audioNodes.length !== this._outputsAmount) throw new Error(`input nodes amount differs from the system's outputs amount!
            Expected ${this._outputsAmount} got ${audioNodes.length}`);
    for (let channel = 0; channel < this._outputsAmount; channel++) this.connectChannel(audioNodes[channel], channel);
  }
  /**
  * Disconnects the individual audio outputs from the given audio nodes.
  * @param audioNodes Exactly 16 outputs.
  */
  disconnectIndividualOutputs(audioNodes) {
    if (audioNodes.length !== this._outputsAmount) throw new Error(`input nodes amount differs from the system's outputs amount!
            Expected ${this._outputsAmount} got ${audioNodes.length}`);
    for (let channel = 0; channel < this._outputsAmount; channel++) this.disconnectChannel(audioNodes[channel], channel);
  }
  /**
  * Disables the GS NRPN parameters like vibrato or drum key tuning.
  * @deprecated Deprecated! Please use master parameters
  */
  disableGSNPRNParams() {
    this.setMasterParameter("nprnParamLock", true);
  }
  /**
  * Sends a raw MIDI message to the synthesizer.
  * @param message the midi message, each number is a byte.
  * @param channelOffset the channel offset of the message.
  * @param eventOptions additional options for this command.
  */
  sendMessage(message, channelOffset = 0, eventOptions = DEFAULT_SYNTH_METHOD_OPTIONS) {
    this._sendInternal(message, channelOffset, eventOptions);
  }
  /**
  * Starts playing a note
  * @param channel Usually 0-15: the channel to play the note.
  * @param midiNote 0-127 the key number of the note.
  * @param velocity 0-127 the velocity of the note (generally controls loudness).
  * @param eventOptions Additional options for this command.
  */
  noteOn(channel, midiNote, velocity, eventOptions = DEFAULT_SYNTH_METHOD_OPTIONS) {
    const ch = channel % 16;
    const offset = channel - ch;
    midiNote %= 128;
    velocity %= 128;
    this.sendMessage([
      midiMessageTypes.noteOn | ch,
      midiNote,
      velocity
    ], offset, eventOptions);
  }
  /**
  * Stops playing a note.
  * @param channel Usually 0-15: the channel of the note.
  * @param midiNote {number} 0-127 the key number of the note.
  * @param eventOptions Additional options for this command.
  */
  noteOff(channel, midiNote, eventOptions = DEFAULT_SYNTH_METHOD_OPTIONS) {
    midiNote %= 128;
    const ch = channel % 16;
    const offset = channel - ch;
    this._sendInternal([midiMessageTypes.noteOff | ch, midiNote], offset, eventOptions);
  }
  /**
  * Stops all notes.
  * @param force If the notes should immediately be stopped, defaults to false.
  */
  stopAll(force = false) {
    this.post({
      channelNumber: ALL_CHANNELS_OR_DIFFERENT_ACTION,
      type: "stopAll",
      data: force ? 1 : 0
    });
  }
  /**
  * Changes the given controller
  * @param channel Usually 0-15: the channel to change the controller.
  * @param controllerNumber 0-127 the MIDI CC number.
  * @param controllerValue 0-127 the controller value.
  * @param eventOptions Additional options for this command.
  */
  controllerChange(channel, controllerNumber, controllerValue, eventOptions = DEFAULT_SYNTH_METHOD_OPTIONS) {
    if (controllerNumber > 127 || controllerNumber < 0) throw new Error(`Invalid controller number: ${controllerNumber}`);
    controllerValue = Math.floor(controllerValue) % 128;
    controllerNumber = Math.floor(controllerNumber) % 128;
    const ch = channel % 16;
    const offset = channel - ch;
    this._sendInternal([
      midiMessageTypes.controllerChange | ch,
      controllerNumber,
      controllerValue
    ], offset, eventOptions);
  }
  /**
  * Resets all controllers (for every channel)
  */
  resetControllers() {
    this.post({
      channelNumber: ALL_CHANNELS_OR_DIFFERENT_ACTION,
      type: "ccReset",
      data: null
    });
  }
  /**
  * Causes the given midi channel to ignore controller messages for the given controller number.
  * @param channel Usually 0-15: the channel to lock.
  * @param controllerNumber 0-127 MIDI CC number.
  * @param isLocked True if locked, false if unlocked.
  * @remarks
  *  Controller number -1 locks the preset.
  */
  lockController(channel, controllerNumber, isLocked) {
    this.post({
      channelNumber: channel,
      type: "lockController",
      data: {
        controllerNumber,
        isLocked
      }
    });
  }
  /**
  * Applies pressure to a given channel.
  * @param channel Usually 0-15: the channel to change the controller.
  * @param pressure 0-127: the pressure to apply.
  * @param eventOptions Additional options for this command.
  */
  channelPressure(channel, pressure, eventOptions = DEFAULT_SYNTH_METHOD_OPTIONS) {
    const ch = channel % 16;
    const offset = channel - ch;
    pressure %= 128;
    this.sendMessage([midiMessageTypes.channelPressure | ch, pressure], offset, eventOptions);
  }
  /**
  * Applies pressure to a given note.
  * @param channel Usually 0-15: the channel to change the controller.
  * @param midiNote 0-127: the MIDI note.
  * @param pressure 0-127: the pressure to apply.
  * @param eventOptions Additional options for this command.
  */
  polyPressure(channel, midiNote, pressure, eventOptions = DEFAULT_SYNTH_METHOD_OPTIONS) {
    const ch = channel % 16;
    const offset = channel - ch;
    midiNote %= 128;
    pressure %= 128;
    this.sendMessage([
      midiMessageTypes.polyPressure | ch,
      midiNote,
      pressure
    ], offset, eventOptions);
  }
  /**
  * Sets the pitch of the given channel.
  * @param channel Usually 0-15: the channel to change pitch.
  * @param value The bend of the MIDI pitch wheel message. 0 - 16384
  * @param eventOptions Additional options for this command.
  */
  pitchWheel(channel, value, eventOptions = DEFAULT_SYNTH_METHOD_OPTIONS) {
    const ch = channel % 16;
    const offset = channel - ch;
    this.sendMessage([
      midiMessageTypes.pitchWheel | ch,
      value & 127,
      value >> 7
    ], offset, eventOptions);
  }
  /**
  * Sets the channel's pitch wheel range, in semitones.
  * @param channel Usually 0-15: the channel to change.
  * @param range The bend range in semitones.
  * @param eventOptions Additional options for this command.
  */
  pitchWheelRange(channel, range, eventOptions = DEFAULT_SYNTH_METHOD_OPTIONS) {
    this.controllerChange(channel, midiControllers.registeredParameterMSB, 0, eventOptions);
    this.controllerChange(channel, midiControllers.registeredParameterLSB, 0, eventOptions);
    this.controllerChange(channel, midiControllers.dataEntryMSB, range);
    this.controllerChange(channel, midiControllers.registeredParameterMSB, 127, eventOptions);
    this.controllerChange(channel, midiControllers.registeredParameterLSB, 127, eventOptions);
    this.controllerChange(channel, midiControllers.dataEntryMSB, 0, eventOptions);
  }
  /**
  * Changes the program for a given channel
  * @param channel Usually 0-15: the channel to change.
  * @param programNumber 0-127 the MIDI patch number.
  * @param eventOptions Additional options for this command.
  */
  programChange(channel, programNumber, eventOptions = DEFAULT_SYNTH_METHOD_OPTIONS) {
    const ch = channel % 16;
    const offset = channel - ch;
    programNumber %= 128;
    this.sendMessage([midiMessageTypes.programChange | ch, programNumber], offset, eventOptions);
  }
  /**
  * Transposes the channel by given number of semitones.
  * @param channel The channel number.
  * @param semitones The transposition of the channel, it can be a float.
  * @param force Defaults to false, if true transposes the channel even if it's a drum channel.
  */
  transposeChannel(channel, semitones, force = false) {
    this.post({
      channelNumber: channel,
      type: "transposeChannel",
      data: {
        semitones,
        force
      }
    });
  }
  /**
  * Mutes or unmutes the given channel.
  * @param channel Usually 0-15: the channel to mute.
  * @param isMuted Indicates if the channel is muted.
  */
  muteChannel(channel, isMuted) {
    this.post({
      channelNumber: channel,
      type: "muteChannel",
      data: isMuted
    });
  }
  /**
  * Sends a MIDI Sysex message to the synthesizer.
  * @param messageData The message's data, excluding the F0 byte, but including the F7 at the end.
  * @param channelOffset Channel offset for the system exclusive message, defaults to zero.
  * @param eventOptions Additional options for this command.
  */
  systemExclusive(messageData, channelOffset = 0, eventOptions = DEFAULT_SYNTH_METHOD_OPTIONS) {
    this._sendInternal([midiMessageTypes.systemExclusive, ...Array.from(messageData)], channelOffset, eventOptions);
  }
  /**
  * Tune MIDI keys of a given program using the MIDI Tuning Standard.
  * @param program  0 - 127 the MIDI program number to use.
  * @param tunings The keys and their tunings.
  * TargetPitch of -1 sets the tuning for this key to be tuned regularly.
  */
  tuneKeys(program, tunings) {
    if (tunings.length > 127) throw new Error("Too many tunings. Maximum allowed is 127.");
    const systemExclusive = [
      127,
      16,
      8,
      2,
      program,
      tunings.length
    ];
    for (const tuning of tunings) {
      systemExclusive.push(tuning.sourceKey);
      if (tuning.targetPitch === -1) systemExclusive.push(127, 127, 127);
      else {
        const midiNote = Math.floor(tuning.targetPitch);
        const fraction = Math.floor((tuning.targetPitch - midiNote) / 61e-6);
        systemExclusive.push(midiNote, fraction >> 7 & 127, fraction & 127);
      }
    }
    systemExclusive.push(247);
    this.systemExclusive(systemExclusive);
  }
  /**
  * Toggles drums on a given channel.
  * @param channel The channel number.
  * @param isDrum If the channel should be drums.
  */
  setDrums(channel, isDrum) {
    this.post({
      channelNumber: channel,
      type: "setDrums",
      data: isDrum
    });
  }
  /**
  * Yes please!
  */
  reverbateEverythingBecauseWhyNot() {
    for (let i = 0; i < this.channelsAmount; i++) {
      this.controllerChange(i, midiControllers.reverbDepth, 127);
      this.lockController(i, midiControllers.reverbDepth, true);
    }
    return "That's the spirit!";
  }
  /**
  * INTERNAL USE ONLY!
  * @param type INTERNAL USE ONLY!
  * @param resolve INTERNAL USE ONLY!
  * @internal
  */
  awaitWorkerResponse(type, resolve) {
    this.resolveMap.set(type, resolve);
  }
  /**
  * INTERNAL USE ONLY!
  * @param callback the sequencer callback
  * @internal
  */
  assignNewSequencer(callback) {
    this.post({
      channelNumber: -1,
      type: "requestNewSequencer",
      data: null
    });
    this.sequencers.push(callback);
    return this.sequencers.length - 1;
  }
  assignProgressTracker(type, progressFunction) {
    if (this.renderingProgressTracker.get(type)) throw new Error("Something is already being rendered!");
    this.renderingProgressTracker.set(type, progressFunction);
  }
  revokeProgressTracker(type) {
    this.renderingProgressTracker.delete(type);
  }
  _sendInternal(message, channelOffset, eventOptions) {
    const options = fillWithDefaults2(eventOptions, DEFAULT_SYNTH_METHOD_OPTIONS);
    this.post({
      type: "midiMessage",
      channelNumber: ALL_CHANNELS_OR_DIFFERENT_ACTION,
      data: {
        messageData: new Uint8Array(message),
        channelOffset,
        options
      }
    });
  }
  /**
  * Handles the messages received from the worklet.
  */
  handleMessage(m) {
    switch (m.type) {
      case "eventCall":
        this.eventHandler.callEventInternal(m.data.type, m.data.data);
        break;
      case "sequencerReturn":
        this.sequencers[m.data.id]?.(m.data);
        break;
      case "isFullyInitialized":
        this.workletResponds(m.data.type, m.data.data);
        break;
      case "soundBankError":
        SpessaSynthCoreUtils.SpessaSynthWarn(m.data);
        this.eventHandler.callEventInternal("soundBankError", m.data);
        break;
      case "renderingProgress":
        this.renderingProgressTracker.get(m.data.type)?.(m.data.data);
    }
  }
  addNewChannelInternal(post) {
    this.channelProperties.push({
      voicesAmount: 0,
      pitchWheel: 0,
      pitchWheelRange: 0,
      isMuted: false,
      isDrum: this.channelsAmount % 16 === DEFAULT_PERCUSSION,
      isEFX: false,
      transposition: 0
    });
    if (!post) return;
    this.post({
      channelNumber: 0,
      type: "addNewChannel",
      data: null
    });
  }
  workletResponds(type, data) {
    this.resolveMap.get(type)?.(data);
    this.resolveMap.delete(type);
  }
};
var WorkletSynthesizer = class extends BasicSynthesizer {
  /**
  * Creates a new instance of an AudioWorklet-based synthesizer.
  * @param context The audio context.
  * @param config Optional configuration for the synthesizer.
  */
  constructor(context, config = DEFAULT_SYNTH_CONFIG) {
    const synthConfig = fillWithDefaults2(config, DEFAULT_SYNTH_CONFIG);
    let outputChannelCount = new Array(17).fill(2);
    let numberOfOutputs = 17;
    if (synthConfig.oneOutput) {
      outputChannelCount = [34];
      numberOfOutputs = 1;
    }
    let worklet;
    try {
      worklet = (synthConfig?.audioNodeCreators?.worklet ?? ((context2, name, options) => {
        return new AudioWorkletNode(context2, name, options);
      }))(context, WORKLET_PROCESSOR_NAME, {
        outputChannelCount,
        numberOfOutputs,
        processorOptions: {
          oneOutput: synthConfig.oneOutput,
          enableEventSystem: synthConfig.enableEventSystem
        }
      });
    } catch (error) {
      console.error(error);
      throw new Error("Could not create the AudioWorkletNode. Did you forget to addModule()?", { cause: error });
    }
    super(worklet, (data, transfer = []) => {
      worklet.port.postMessage(data, transfer);
    }, synthConfig);
  }
  /**
  * Starts an offline audio render.
  * @param config The configuration to use.
  * @remarks
  * Call this method immediately after you've set up the synthesizer.
  * Do NOT call any other methods after initializing before this one.
  * Chromium seems to ignore worklet messages for OfflineAudioContext.
  */
  async startOfflineRender(config) {
    this.post({
      type: "startOfflineRender",
      data: config,
      channelNumber: -1
    }, config.soundBankList.map((b) => b.soundBankBuffer));
    await new Promise((r) => this.awaitWorkerResponse("startOfflineRender", r));
  }
  /**
  * Destroys the synthesizer instance.
  */
  destroy() {
    this.post({
      channelNumber: 0,
      type: "destroyWorklet",
      data: null
    });
    this.worklet.disconnect();
    delete this.worklet;
  }
};
var DEFAULT_BANK_WRITE_OPTIONS = {
  trim: true,
  bankID: "",
  writeEmbeddedSoundBank: true,
  sequencerID: 0
};
var DEFAULT_SF2_WRITE_OPTIONS2 = {
  ...DEFAULT_BANK_WRITE_OPTIONS,
  writeDefaultModulators: true,
  writeExtendedLimits: true,
  compress: false,
  compressionQuality: 1,
  decompress: false
};
var DEFAULT_RMIDI_WRITE_OPTIONS2 = {
  ...DEFAULT_BANK_WRITE_OPTIONS,
  bankOffset: 0,
  correctBankOffset: true,
  metadata: {},
  format: "sf2",
  ...DEFAULT_SF2_WRITE_OPTIONS2
};
var DEFAULT_DLS_WRITE_OPTIONS = { ...DEFAULT_BANK_WRITE_OPTIONS };
var MIDIDataTrack = class extends MIDITrack {
  /**
  * THIS DATA WILL BE EMPTY! USE sequencer.getMIDI() TO GET THE ACTUAL DATA!
  */
  events = [];
  constructor(track) {
    super();
    super.copyFrom(track);
    this.events = [];
  }
};
var MIDIData = class MIDIData2 extends BasicMIDI {
  tracks;
  /**
  * THIS DATA WILL BE EMPTY! USE sequencer.getMIDI() TO GET THE ACTUAL DATA!
  */
  embeddedSoundBank = void 0;
  /**
  * The byte length of the sound bank if it exists.
  */
  embeddedSoundBankSize;
  constructor(mid) {
    super();
    super.copyMetadataFrom(mid);
    this.tracks = mid.tracks.map((t) => new MIDIDataTrack(t));
    this.embeddedSoundBankSize = mid instanceof MIDIData2 ? mid.embeddedSoundBankSize : mid?.embeddedSoundBank?.byteLength;
  }
};
var songChangeType = {
  shuffleOn: 1,
  shuffleOff: 2,
  index: 3
};
var DEFAULT_SEQUENCER_OPTIONS = {
  skipToFirstNoteOn: true,
  initialPlaybackRate: 1
};
var SeqEventHandler = class {
  /**
  * The time delay before an event is called.
  * Set to 0 to disable it.
  */
  timeDelay = 0;
  events = {
    songChange: /* @__PURE__ */ new Map(),
    songEnded: /* @__PURE__ */ new Map(),
    metaEvent: /* @__PURE__ */ new Map(),
    timeChange: /* @__PURE__ */ new Map(),
    midiError: /* @__PURE__ */ new Map(),
    textEvent: /* @__PURE__ */ new Map()
  };
  /**
  * Adds a new event listener.
  * @param event The event to listen to.
  * @param id The unique identifier for the event. It can be used to overwrite existing callback with the same ID.
  * @param callback The callback for the event.
  */
  addEvent(event, id, callback) {
    this.events[event].set(id, callback);
  }
  /**
  * Removes an event listener
  * @param name The event to remove a listener from.
  * @param id The unique identifier for the event to remove.
  */
  removeEvent(name, id) {
    this.events[name].delete(id);
  }
  /**
  * Calls the given event.
  * Internal use only.
  * @internal
  */
  callEventInternal(name, eventData) {
    const eventList = this.events[name];
    const callback = () => {
      for (const callback2 of eventList.values()) try {
        callback2(eventData);
      } catch (error) {
        console.error(`Error while executing a sequencer event callback for ${name}:`, error);
      }
    };
    if (this.timeDelay > 0) setTimeout(callback.bind(this), this.timeDelay * 1e3);
    else callback();
  }
};
var Sequencer = class {
  /**
  * The current MIDI data for all songs, like the midiData property.
  */
  songListData = [];
  /**
  * Allows setting up custom event listeners for the sequencer.
  */
  eventHandler = new SeqEventHandler();
  /**
  * Indicates whether the sequencer has finished playing a sequence.
  */
  isFinished = false;
  /**
  * The synthesizer attached to this sequencer.
  */
  synth;
  /**
  * The current MIDI data, with the exclusion of the embedded sound bank and event data.
  */
  midiData;
  /**
  * The MIDI port to play to.
  */
  midiOut;
  isLoading = false;
  /**
  * Indicates if the sequencer is paused.
  * Paused if a number, undefined if playing.
  */
  pausedTime = 0;
  getMIDICallback = void 0;
  highResTimeOffset = 0;
  /**
  * Absolute playback startTime, bases on the synth's time.
  */
  absoluteStartTime;
  /**
  * For sending the messages to the correct SpessaSynthSequencer in core
  */
  sequencerID;
  /**
  * Creates a new MIDI sequencer for playing back MIDI files.
  * @param synth synth to send events to.
  * @param options the sequencer's options.
  */
  constructor(synth, options = DEFAULT_SEQUENCER_OPTIONS) {
    this.synth = synth;
    this.absoluteStartTime = this.synth.currentTime;
    this.sequencerID = this.synth.assignNewSequencer(this.handleMessage.bind(this));
    this._skipToFirstNoteOn = options?.skipToFirstNoteOn ?? true;
    if (options?.initialPlaybackRate !== 1) this.playbackRate = options?.initialPlaybackRate ?? 1;
    if (!this._skipToFirstNoteOn) this.sendMessage("setSkipToFirstNote", false);
    window.addEventListener("beforeunload", this.resetMIDIOutput.bind(this));
  }
  _shuffledSongIndexes = [];
  /**
  * The shuffled song indexes.
  * This is used when shuffleMode is enabled.
  */
  get shuffledSongIndexes() {
    return this._shuffledSongIndexes;
  }
  _songIndex = 0;
  /**
  * The current song number in the playlist.
  * If shuffle Mode is enabled, this is the index of the shuffled song list.
  */
  get songIndex() {
    return this._songIndex;
  }
  /**
  * The current song number in the playlist.
  * If shuffle Mode is enabled, this is the index of the shuffled song list.
  */
  set songIndex(value) {
    const clamped = Math.max(0, value % this._songsAmount);
    if (clamped === this._songIndex) return;
    this.isLoading = true;
    this.midiData = void 0;
    this.sendMessage("changeSong", {
      changeType: songChangeType.index,
      data: clamped
    });
  }
  _currentTempo = 120;
  /**
  * Current song's tempo in BPM.
  */
  get currentTempo() {
    return this._currentTempo;
  }
  /**
  * The current sequence's length, in seconds.
  */
  get duration() {
    return this.midiData?.duration ?? 0;
  }
  _songsAmount = 0;
  get songsAmount() {
    return this._songsAmount;
  }
  _skipToFirstNoteOn;
  /**
  * Indicates if the sequencer should skip to first note on.
  */
  get skipToFirstNoteOn() {
    return this._skipToFirstNoteOn;
  }
  /**
  * Indicates if the sequencer should skip to first note on.
  */
  set skipToFirstNoteOn(val) {
    this._skipToFirstNoteOn = val;
    this.sendMessage("setSkipToFirstNote", this._skipToFirstNoteOn);
  }
  /**
  * Internal loop count marker (-1 is infinite).
  */
  _loopCount = -1;
  /**
  * The current remaining number of loops. -1 means infinite looping.
  */
  get loopCount() {
    return this._loopCount;
  }
  /**
  * The current remaining number of loops. -1 means infinite looping.
  */
  set loopCount(val) {
    this._loopCount = val;
    this.sendMessage("setLoopCount", val);
  }
  /**
  * Controls the playback's rate.
  */
  _playbackRate = 1;
  /**
  * Controls the playback's rate.
  */
  get playbackRate() {
    return this._playbackRate;
  }
  /**
  * Controls the playback's rate.
  */
  set playbackRate(value) {
    const t = this.currentTime;
    this.sendMessage("setPlaybackRate", value);
    this.highResTimeOffset *= value / this._playbackRate;
    this._playbackRate = value;
    this.recalculateStartTime(t);
  }
  _shuffleSongs = false;
  /**
  * Controls if the sequencer should shuffle the songs in the song list.
  * If true, the sequencer will play the songs in a random order.
  *
  * Songs are shuffled on a `loadNewSongList` call.
  */
  get shuffleSongs() {
    return this._shuffleSongs;
  }
  /**
  * Controls if the sequencer should shuffle the songs in the song list.
  * If true, the sequencer will play the songs in a random order.
  *
  * Songs are shuffled on a `loadNewSongList` call.
  */
  set shuffleSongs(value) {
    this._shuffleSongs = value;
    if (value) this.sendMessage("changeSong", { changeType: songChangeType.shuffleOn });
    else this.sendMessage("changeSong", { changeType: songChangeType.shuffleOff });
  }
  /**
  * Current playback time, in seconds.
  */
  get currentTime() {
    if (this.isLoading) return 0;
    if (this.pausedTime !== void 0) return this.pausedTime;
    return (this.synth.currentTime - this.absoluteStartTime) * this._playbackRate;
  }
  /**
  * Current playback time, in seconds.
  */
  set currentTime(time) {
    this.sendMessage("setTime", time);
  }
  /**
  * A smoothed version of currentTime.
  * Use for visualization as it's not affected by the audioContext stutter.
  */
  get currentHighResolutionTime() {
    if (this.pausedTime !== void 0) return this.pausedTime;
    const highResTimeOffset = this.highResTimeOffset;
    const absoluteStartTime = this.absoluteStartTime;
    const performanceElapsedTime = (performance.now() / 1e3 - absoluteStartTime) * this._playbackRate;
    let currentPerformanceTime = highResTimeOffset + performanceElapsedTime;
    const currentAudioTime = this.currentTime;
    const smoothingFactor = 0.01 * this._playbackRate;
    const timeDifference = currentAudioTime - currentPerformanceTime;
    this.highResTimeOffset += timeDifference * smoothingFactor;
    currentPerformanceTime = this.highResTimeOffset + performanceElapsedTime;
    return currentPerformanceTime;
  }
  /**
  * True if paused, false if playing or stopped.
  */
  get paused() {
    return this.pausedTime !== void 0;
  }
  /**
  * Gets the current MIDI File.
  */
  async getMIDI() {
    return new Promise((resolve) => {
      this.getMIDICallback = resolve;
      this.sendMessage("getMIDI", null);
    });
  }
  /**
  * Loads a new song list.
  * @param midiBuffers The MIDI files to play.
  */
  loadNewSongList(midiBuffers) {
    this.isLoading = true;
    this.midiData = void 0;
    this.sendMessage("loadNewSongList", midiBuffers);
    this._songIndex = 0;
    this._songsAmount = midiBuffers.length;
  }
  /**
  * Connects a given output to the sequencer.
  * @param output The output to connect. Pass undefined to use the connected synthesizer.
  */
  connectMIDIOutput(output) {
    this.resetMIDIOutput();
    this.midiOut = output;
    this.sendMessage("changeMIDIMessageSending", output !== void 0);
    this.currentTime -= 0.1;
  }
  /**
  * Pauses the playback.
  */
  pause() {
    if (this.paused) return;
    this.pausedTime = this.currentTime;
    this.sendMessage("pause", null);
  }
  /**
  * Starts or resumes the playback.
  */
  play() {
    this.recalculateStartTime(this.pausedTime ?? 0);
    this.pausedTime = void 0;
    this.isFinished = false;
    this.sendMessage("play", null);
  }
  handleMessage(m) {
    switch (m.type) {
      case "midiMessage": {
        const midiEventData = m.data.message;
        if (this.midiOut && midiEventData[0] >= 128) {
          this.midiOut.send(midiEventData);
          return;
        }
        break;
      }
      case "songChange": {
        this._songIndex = m.data.songIndex;
        const idx = this._shuffleSongs ? this._shuffledSongIndexes[this._songIndex] : this._songIndex;
        const songChangeData = this.songListData[idx];
        this.midiData = songChangeData;
        this.isLoading = false;
        this.absoluteStartTime = 0;
        this.callEventInternal("songChange", songChangeData);
        break;
      }
      case "sync":
        if (Math.abs(m.data - this.currentTime) > 0.05) this.recalculateStartTime(m.data);
        break;
      case "timeChange": {
        const time = m.data.newTime;
        this.recalculateStartTime(time);
        this.callEventInternal("timeChange", time);
        break;
      }
      case "pause":
        this.pausedTime = this.currentTime;
        this.isFinished = m.data.isFinished;
        if (this.isFinished) this.callEventInternal("songEnded", null);
        break;
      case "midiError":
        this.callEventInternal("midiError", m.data);
        break;
      case "getMIDI":
        if (this.getMIDICallback) this.getMIDICallback(BasicMIDI.copyFrom(m.data));
        break;
      case "metaEvent": {
        const event = m.data.event;
        switch (event.statusByte) {
          case midiMessageTypes.setTempo:
            this._currentTempo = 6e7 / SpessaSynthCoreUtils.readBytesAsUintBigEndian(event.data, 3);
            break;
          case midiMessageTypes.text:
          case midiMessageTypes.lyric:
          case midiMessageTypes.copyright:
          case midiMessageTypes.trackName:
          case midiMessageTypes.marker:
          case midiMessageTypes.cuePoint:
          case midiMessageTypes.instrumentName:
          case midiMessageTypes.programName: {
            if (!this.midiData) break;
            let lyricsIndex = -1;
            if (event.statusByte === midiMessageTypes.lyric) lyricsIndex = Math.min(this.midiData.lyrics.findIndex((l) => l.ticks === event.ticks), this.midiData.lyrics.length - 1);
            if (this.midiData.isKaraokeFile && (event.statusByte === midiMessageTypes.text || event.statusByte === midiMessageTypes.lyric)) lyricsIndex = Math.min(this.midiData.lyrics.findIndex((l) => l.ticks === event.ticks), this.midiData.lyrics.length);
            this.callEventInternal("textEvent", {
              event,
              lyricsIndex
            });
            break;
          }
        }
        this.callEventInternal("metaEvent", {
          event: m.data.event,
          trackNumber: m.data.trackIndex
        });
        break;
      }
      case "loopCountChange":
        this._loopCount = m.data.newCount;
        break;
      case "songListChange":
        this.songListData = m.data.newSongList.map((m2) => new MIDIData(m2));
        this._shuffledSongIndexes = m.data.shuffledSongIndexes;
        break;
      default:
        break;
    }
  }
  callEventInternal(type, data) {
    this.eventHandler.callEventInternal(type, data);
  }
  resetMIDIOutput() {
    if (!this.midiOut) return;
    for (let i = 0; i < 16; i++) {
      this.midiOut.send([
        midiMessageTypes.controllerChange | i,
        120,
        0
      ]);
      this.midiOut.send([
        midiMessageTypes.controllerChange | i,
        123,
        0
      ]);
    }
    this.midiOut.send([midiMessageTypes.reset]);
  }
  recalculateStartTime(time) {
    this.absoluteStartTime = this.synth.currentTime - time / this._playbackRate;
    this.highResTimeOffset = (this.synth.currentTime - performance.now() / 1e3) * this._playbackRate;
    if (this.paused) this.pausedTime = time;
  }
  sendMessage(messageType, messageData) {
    this.synth.post({
      channelNumber: ALL_CHANNELS_OR_DIFFERENT_ACTION,
      type: "sequencerSpecific",
      data: {
        type: messageType,
        data: messageData,
        id: this.sequencerID
      }
    });
  }
};

// node_modules/pitchy/index.js
var import_fft = __toESM(require_fft(), 1);
var Autocorrelator = class _Autocorrelator {
  /** @private @readonly @type {number} */
  _inputLength;
  /** @private @type {FFT} */
  _fft;
  /** @private @type {(size: number) => T} */
  _bufferSupplier;
  /** @private @type {T} */
  _paddedInputBuffer;
  /** @private @type {T} */
  _transformBuffer;
  /** @private @type {T} */
  _inverseBuffer;
  /**
   * A helper method to create an {@link Autocorrelator} using
   * {@link Float32Array} buffers.
   *
   * @param inputLength {number} the input array length to support
   * @returns {Autocorrelator<Float32Array>}
   */
  static forFloat32Array(inputLength) {
    return new _Autocorrelator(
      inputLength,
      (length) => new Float32Array(length)
    );
  }
  /**
   * A helper method to create an {@link Autocorrelator} using
   * {@link Float64Array} buffers.
   *
   * @param inputLength {number} the input array length to support
   * @returns {Autocorrelator<Float64Array>}
   */
  static forFloat64Array(inputLength) {
    return new _Autocorrelator(
      inputLength,
      (length) => new Float64Array(length)
    );
  }
  /**
   * A helper method to create an {@link Autocorrelator} using `number[]`
   * buffers.
   *
   * @param inputLength {number} the input array length to support
   * @returns {Autocorrelator<number[]>}
   */
  static forNumberArray(inputLength) {
    return new _Autocorrelator(inputLength, (length) => Array(length));
  }
  /**
   * Constructs a new {@link Autocorrelator} able to handle input arrays of the
   * given length.
   *
   * @param inputLength {number} the input array length to support. This
   * `Autocorrelator` will only support operation on arrays of this length.
   * @param bufferSupplier {(length: number) => T} the function to use for
   * creating buffers, accepting the length of the buffer to create and
   * returning a new buffer of that length. The values of the returned buffer
   * need not be initialized in any particular way.
   */
  constructor(inputLength, bufferSupplier) {
    if (inputLength < 1) {
      throw new Error(`Input length must be at least one`);
    }
    this._inputLength = inputLength;
    this._fft = new import_fft.default(ceilPow2(2 * inputLength));
    this._bufferSupplier = bufferSupplier;
    this._paddedInputBuffer = this._bufferSupplier(this._fft.size);
    this._transformBuffer = this._bufferSupplier(2 * this._fft.size);
    this._inverseBuffer = this._bufferSupplier(2 * this._fft.size);
  }
  /**
   * Returns the supported input length.
   *
   * @returns {number} the supported input length
   */
  get inputLength() {
    return this._inputLength;
  }
  /**
   * Autocorrelates the given input data.
   *
   * @param input {ArrayLike<number>} the input data to autocorrelate
   * @param output {T} the output buffer into which to write the autocorrelated
   * data. If not provided, a new buffer will be created.
   * @returns {T} `output`
   */
  autocorrelate(input, output = this._bufferSupplier(input.length)) {
    if (input.length !== this._inputLength) {
      throw new Error(
        `Input must have length ${this._inputLength} but had length ${input.length}`
      );
    }
    for (let i = 0; i < input.length; i++) {
      this._paddedInputBuffer[i] = input[i];
    }
    for (let i = input.length; i < this._paddedInputBuffer.length; i++) {
      this._paddedInputBuffer[i] = 0;
    }
    this._fft.realTransform(this._transformBuffer, this._paddedInputBuffer);
    this._fft.completeSpectrum(this._transformBuffer);
    const tb = this._transformBuffer;
    for (let i = 0; i < tb.length; i += 2) {
      tb[i] = tb[i] * tb[i] + tb[i + 1] * tb[i + 1];
      tb[i + 1] = 0;
    }
    this._fft.inverseTransform(this._inverseBuffer, this._transformBuffer);
    for (let i = 0; i < input.length; i++) {
      output[i] = this._inverseBuffer[2 * i];
    }
    return output;
  }
};
function getKeyMaximumIndices(input) {
  const keyIndices = [];
  let lookingForMaximum = false;
  let max = -Infinity;
  let maxIndex = -1;
  for (let i = 1; i < input.length - 1; i++) {
    if (input[i - 1] <= 0 && input[i] > 0) {
      lookingForMaximum = true;
      maxIndex = i;
      max = input[i];
    } else if (input[i - 1] > 0 && input[i] <= 0) {
      lookingForMaximum = false;
      if (maxIndex !== -1) {
        keyIndices.push(maxIndex);
      }
    } else if (lookingForMaximum && input[i] > max) {
      max = input[i];
      maxIndex = i;
    }
  }
  return keyIndices;
}
function refineResultIndex(index, data) {
  const [x0, x1, x2] = [index - 1, index, index + 1];
  const [y0, y1, y2] = [data[x0], data[x1], data[x2]];
  const a = y0 / 2 - y1 + y2 / 2;
  const b = -(y0 / 2) * (x1 + x2) + y1 * (x0 + x2) - y2 / 2 * (x0 + x1);
  const c = y0 * x1 * x2 / 2 - y1 * x0 * x2 + y2 * x0 * x1 / 2;
  const xMax = -b / (2 * a);
  const yMax = a * xMax * xMax + b * xMax + c;
  return [xMax, yMax];
}
var PitchDetector = class _PitchDetector {
  /** @private @type {Autocorrelator<T>} */
  _autocorrelator;
  /** @private @type {T} */
  _nsdfBuffer;
  /** @private @type {number} */
  _clarityThreshold = 0.9;
  /** @private @type {number} */
  _minVolumeAbsolute = 0;
  /** @private @type {number} */
  _maxInputAmplitude = 1;
  /**
   * A helper method to create an {@link PitchDetector} using {@link Float32Array} buffers.
   *
   * @param inputLength {number} the input array length to support
   * @returns {PitchDetector<Float32Array>}
   */
  static forFloat32Array(inputLength) {
    return new _PitchDetector(inputLength, (length) => new Float32Array(length));
  }
  /**
   * A helper method to create an {@link PitchDetector} using {@link Float64Array} buffers.
   *
   * @param inputLength {number} the input array length to support
   * @returns {PitchDetector<Float64Array>}
   */
  static forFloat64Array(inputLength) {
    return new _PitchDetector(inputLength, (length) => new Float64Array(length));
  }
  /**
   * A helper method to create an {@link PitchDetector} using `number[]` buffers.
   *
   * @param inputLength {number} the input array length to support
   * @returns {PitchDetector<number[]>}
   */
  static forNumberArray(inputLength) {
    return new _PitchDetector(inputLength, (length) => Array(length));
  }
  /**
   * Constructs a new {@link PitchDetector} able to handle input arrays of the
   * given length.
   *
   * @param inputLength {number} the input array length to support. This
   * `PitchDetector` will only support operation on arrays of this length.
   * @param bufferSupplier {(inputLength: number) => T} the function to use for
   * creating buffers, accepting the length of the buffer to create and
   * returning a new buffer of that length. The values of the returned buffer
   * need not be initialized in any particular way.
   */
  constructor(inputLength, bufferSupplier) {
    this._autocorrelator = new Autocorrelator(inputLength, bufferSupplier);
    this._nsdfBuffer = bufferSupplier(inputLength);
  }
  /**
   * Returns the supported input length.
   *
   * @returns {number} the supported input length
   */
  get inputLength() {
    return this._autocorrelator.inputLength;
  }
  /**
   * Sets the clarity threshold used when identifying the correct pitch (the constant
   * `k` from the MPM paper). The value must be between 0 (exclusive) and 1
   * (inclusive), with the most suitable range being between 0.8 and 1.
   *
   * @param threshold {number} the clarity threshold
   */
  set clarityThreshold(threshold) {
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
      throw new Error("clarityThreshold must be a number in the range (0, 1]");
    }
    this._clarityThreshold = threshold;
  }
  /**
   * Sets the minimum detectable volume, as an absolute number between 0 and
   * `maxInputAmplitude`, inclusive, to consider in a sample when detecting the
   * pitch. If a sample fails to meet this minimum volume, `findPitch` will
   * return a clarity of 0.
   *
   * Volume is calculated as the RMS (root mean square) of the input samples.
   *
   * @param volume {number} the minimum volume as an absolute amplitude value
   */
  set minVolumeAbsolute(volume) {
    if (!Number.isFinite(volume) || volume < 0 || volume > this._maxInputAmplitude) {
      throw new Error(
        `minVolumeAbsolute must be a number in the range [0, ${this._maxInputAmplitude}]`
      );
    }
    this._minVolumeAbsolute = volume;
  }
  /**
   * Sets the minimum volume using a decibel measurement. Must be less than or
   * equal to 0: 0 indicates the loudest possible sound (see
   * `maxInputAmplitude`), -10 is a sound with a tenth of the volume of the
   * loudest possible sound, etc.
   *
   * Volume is calculated as the RMS (root mean square) of the input samples.
   *
   * @param db {number} the minimum volume in decibels, with 0 being the loudest
   * sound
   */
  set minVolumeDecibels(db) {
    if (!Number.isFinite(db) || db > 0) {
      throw new Error("minVolumeDecibels must be a number <= 0");
    }
    this._minVolumeAbsolute = this._maxInputAmplitude * 10 ** (db / 10);
  }
  /**
   * Sets the maximum amplitude of an input reading. Must be greater than 0.
   *
   * @param amplitude {number} the maximum amplitude (absolute value) of an input reading
   */
  set maxInputAmplitude(amplitude) {
    if (!Number.isFinite(amplitude) || amplitude <= 0) {
      throw new Error("maxInputAmplitude must be a number > 0");
    }
    this._maxInputAmplitude = amplitude;
  }
  /**
   * Returns the pitch detected using McLeod Pitch Method (MPM) along with a
   * measure of its clarity.
   *
   * The clarity is a value between 0 and 1 (potentially inclusive) that
   * represents how "clear" the pitch was. A clarity value of 1 indicates that
   * the pitch was very distinct, while lower clarity values indicate less
   * definite pitches.
   *
   * @param input {ArrayLike<number>} the time-domain input data
   * @param sampleRate {number} the sample rate at which the input data was
   * collected
   * @returns {[number, number]} the detected pitch, in Hz, followed by the
   * clarity. If a pitch cannot be determined from the input, such as if the
   * volume is too low (see `minVolumeAbsolute` and `minVolumeDecibels`), this
   * will be `[0, 0]`.
   */
  findPitch(input, sampleRate) {
    if (this._belowMinimumVolume(input)) return [0, 0];
    this._nsdf(input);
    const keyMaximumIndices = getKeyMaximumIndices(this._nsdfBuffer);
    if (keyMaximumIndices.length === 0) {
      return [0, 0];
    }
    const nMax = Math.max(...keyMaximumIndices.map((i) => this._nsdfBuffer[i]));
    const resultIndex = keyMaximumIndices.find(
      (i) => this._nsdfBuffer[i] >= this._clarityThreshold * nMax
    );
    const [refinedResultIndex, clarity] = refineResultIndex(
      // @ts-expect-error resultIndex is guaranteed to be defined
      resultIndex,
      this._nsdfBuffer
    );
    return [sampleRate / refinedResultIndex, Math.min(clarity, 1)];
  }
  /**
   * Returns whether the input audio data is below the minimum volume allowed by
   * the pitch detector.
   *
   * @private
   * @param input {ArrayLike<number>}
   * @returns {boolean}
   */
  _belowMinimumVolume(input) {
    if (this._minVolumeAbsolute === 0) return false;
    let squareSum = 0;
    for (let i = 0; i < input.length; i++) {
      squareSum += input[i] ** 2;
    }
    return Math.sqrt(squareSum / input.length) < this._minVolumeAbsolute;
  }
  /**
   * Computes the NSDF of the input and stores it in the internal buffer. This
   * is equation (9) in the McLeod pitch method paper.
   *
   * @private
   * @param input {ArrayLike<number>}
   */
  _nsdf(input) {
    this._autocorrelator.autocorrelate(input, this._nsdfBuffer);
    let m = 2 * this._nsdfBuffer[0];
    let i;
    for (i = 0; i < this._nsdfBuffer.length && m > 0; i++) {
      this._nsdfBuffer[i] = 2 * this._nsdfBuffer[i] / m;
      m -= input[i] ** 2 + input[input.length - i - 1] ** 2;
    }
    for (; i < this._nsdfBuffer.length; i++) {
      this._nsdfBuffer[i] = 0;
    }
  }
};
function ceilPow2(v) {
  v--;
  v |= v >> 1;
  v |= v >> 2;
  v |= v >> 4;
  v |= v >> 8;
  v |= v >> 16;
  v++;
  return v;
}

// src/pkgs/services/Forte.js
function dispatchPlaybackUpdate() {
  document.dispatchEvent(
    new CustomEvent("CherryTree.Forte.Playback.Update", {
      detail: pkg.data.getPlaybackState()
    })
  );
  logVerbose("Dispatching playback update", pkg.data.getPlaybackState());
}
function detectEncoding(uint8Array) {
  const encodings = [
    "utf-8",
    "shift-jis",
    "euc-kr",
    "windows-1250",
    "windows-1252",
    "utf-16le",
    ,
  ];
  for (const encoding of encodings) {
    try {
      const decoder = new TextDecoder(encoding, { fatal: true });
      const text = decoder.decode(uint8Array);
      if (text.includes("\uFFFD")) continue;
      const controlChars = (text.match(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g) || []).length;
      if (text.length > 0 && controlChars / text.length > 0.05) continue;
      return encoding;
    } catch (e) {
      continue;
    }
  }
  return "utf-8";
}
var PITCH_CLASSES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B"
];
var MAJOR_PROFILE = [
  5,
  2,
  3.5,
  2,
  4.5,
  4,
  2,
  4.5,
  2,
  3.5,
  1.5,
  4
];
var MINOR_PROFILE = [
  5,
  2,
  3.5,
  4.5,
  2,
  4,
  2,
  4.5,
  3.5,
  2,
  1.5,
  4
];
function getPearsonCorrelation(chroma, profile) {
  let sumC = 0, sumP = 0, sumCP = 0, sumC2 = 0, sumP2 = 0;
  for (let i = 0; i < 12; i++) {
    sumC += chroma[i];
    sumP += profile[i];
    sumCP += chroma[i] * profile[i];
    sumC2 += chroma[i] * chroma[i];
    sumP2 += profile[i] * profile[i];
  }
  const denom = Math.sqrt(
    (12 * sumC2 - sumC * sumC) * (12 * sumP2 - sumP * sumP)
  );
  if (denom === 0) return 0;
  return (12 * sumCP - sumC * sumP) / denom;
}
function detectMusicalKey(chromaArray) {
  let bestCorrelation = -1;
  let bestKeyIndex = 0;
  let bestMode = "Major";
  for (let rootIndex = 0; rootIndex < 12; rootIndex++) {
    const shiftedChroma = [];
    for (let j = 0; j < 12; j++) {
      shiftedChroma.push(chromaArray[(rootIndex + j) % 12]);
    }
    const majorCorr = getPearsonCorrelation(shiftedChroma, MAJOR_PROFILE);
    const minorCorr = getPearsonCorrelation(shiftedChroma, MINOR_PROFILE);
    if (majorCorr > bestCorrelation) {
      bestCorrelation = majorCorr;
      bestKeyIndex = rootIndex;
      bestMode = "Major";
    }
    if (minorCorr > bestCorrelation) {
      bestCorrelation = minorCorr;
      bestKeyIndex = rootIndex;
      bestMode = "Minor";
    }
  }
  return {
    root: bestKeyIndex,
    mode: bestMode,
    name: `${PITCH_CLASSES[bestKeyIndex]} ${bestMode}`,
    correlation: bestCorrelation
  };
}
function logVerbose(message, ...args) {
  if (!state.verbose) return;
  console.log(`[FORTE SVC] ${message}`, ...args);
}
function logVerboseWarn(message, ...args) {
  if (!state.verbose) return;
  console.warn(`[FORTE SVC] ${message}`, ...args);
}
function bindSpessaEvent(handler, eventName, id, callback) {
  if (!handler || !handler.events) {
    return;
  }
  if (handler.events[eventName] !== void 0) {
    try {
      if (typeof handler.addEvent === "function") {
        handler.addEvent(eventName, id, callback);
        return;
      }
      if (typeof handler.events[eventName].set === "function") {
        handler.events[eventName].set(id, callback);
      } else {
        handler.events[eventName][id] = callback;
      }
    } catch (e) {
      logVerboseWarn(`Error binding event '${eventName}': ${e.message}`);
    }
  } else {
    logVerboseWarn(`Event '${eventName}' does not exist on this handler.`);
  }
}
function updateSfxGain() {
  if (!sfxGain || !audioContext) return;
  const effectiveGain = state.playback.volume * state.playback.sfxVolume;
  sfxGain.gain.setValueAtTime(effectiveGain, audioContext.currentTime);
}
var root;
var audioContext;
var masterGain;
var masterCompressor;
var sourceNode = null;
var sfxSourceNode = null;
var sfxSequencer = null;
var sfxResolve = null;
var animationFrameId = null;
var sfxGain;
var sfxCache = /* @__PURE__ */ new Map();
var sfxMidiOriginalVolume = null;
var pianoRollContainer = null;
var pianoRollCanvas = null;
var pianoRollCtx = null;
var cachedPianoWidth;
var PIXELS_PER_SECOND = 150;
var GUIDE_CLARITY_THRESHOLD = 0.5;
var MIC_CLARITY_THRESHOLD = 0.85;
var RMS_NOISE_GATE = 0.015;
var KEY_AWARE_RMS_GATE = 0.015;
var KEY_AWARE_CLARITY = 0.92;
var MIN_FRAMES_FOR_FULL_SCORE = 900;
var MIN_VOCAL_HZ = 75;
var MAX_VOCAL_HZ = 1200;
var saveVocalChainTimeout = null;
var guideAnalyserBuffer = null;
var saveVolumesTimeout = null;
var micAnalyserBuffer = null;
var lastScoreTime = 0;
var state = {
  scoring: {
    enabled: false,
    userInputEnabled: true,
    micStream: null,
    micSourceNode: null,
    micHighpassNode: null,
    micLowpassNode: null,
    micAnalyser: null,
    vocalGuideAnalyser: null,
    pitchDetector: null,
    guideVocalDelayNode: null,
    finalScore: 0,
    details: {
      accuracy: 0
    },
    measuredLatencyS: 0.5,
    totalScorableNotes: 0,
    notesHit: 0,
    isVocalGuideNoteActive: false,
    hasHitCurrentNote: false,
    micDevices: [],
    currentMicDeviceId: "default",
    musicAnalyser: null,
    meydaAnalyzer: null,
    totalFramesSinging: 0,
    framesInKey: 0,
    rollingChroma: new Array(12).fill(0),
    currentKeyName: null,
    allowedPitchClasses: [],
    keyHistory: [],
    frameCount: 0,
    activeMidiNotes: /* @__PURE__ */ new Set()
  },
  playback: {
    status: "stopped",
    buffer: null,
    synthesizer: null,
    midiGain: null,
    sequencer: null,
    isMidi: false,
    isMultiplexed: false,
    decodedLyrics: [],
    guideNotes: [],
    lyricsEncoding: "utf-8",
    isAnalyzing: false,
    startTime: 0,
    pauseTime: 0,
    devices: [],
    currentDeviceId: "default",
    transpose: 0,
    multiplexPan: -1,
    leftPannerGain: null,
    rightPannerGain: null,
    volume: 1,
    sfxVolume: 1,
    smoothedTime: 0,
    lastFrameTime: 0,
    guideRange: { min: 42, max: 90 },
    midiInfo: {
      ticks: [],
      timeDivision: 480,
      tempoChanges: [],
      initialBpm: 120,
      keyRange: { min: 0, max: 127 }
    }
  },
  recording: {
    destinationNode: null,
    audioStream: null,
    trackDelayNode: null,
    musicRecordingGainNode: null
  },
  effects: {
    micChainInput: null,
    micChainOutput: null,
    vocalChain: [],
    vocalChainConfig: [],
    musicGainInRecording: 0.2,
    micGainInRecording: 1
  },
  ui: {
    pianoRollVisible: true
  },
  verbose: true
};
function updateScore(currentTime) {
  if (!state.scoring.enabled || !state.scoring.pitchDetector || !state.scoring.micAnalyser) {
    return;
  }
  if (!micAnalyserBuffer)
    micAnalyserBuffer = new Float32Array(state.scoring.micAnalyser.fftSize);
  state.scoring.micAnalyser.getFloatTimeDomainData(micAnalyserBuffer);
  const sampleRate = audioContext.sampleRate;
  const [micPitch, micClarity] = state.scoring.pitchDetector.findPitch(
    micAnalyserBuffer,
    sampleRate
  );
  let isCorrectPitch;
  let sumSquares = 0;
  for (let i = 0; i < micAnalyserBuffer.length; i++) {
    sumSquares += micAnalyserBuffer[i] * micAnalyserBuffer[i];
  }
  const rms = Math.sqrt(sumSquares / micAnalyserBuffer.length);
  const isValidPitch = micPitch >= MIN_VOCAL_HZ && micPitch <= MAX_VOCAL_HZ;
  const isSinging = micClarity > MIC_CLARITY_THRESHOLD && isValidPitch && rms > RMS_NOISE_GATE;
  let midiMicPitch = isSinging ? 12 * Math.log2(micPitch / 440) + 69 : 0;
  state.scoring.isSinging = isSinging;
  state.scoring.currentMicMidi = midiMicPitch;
  const isKeyAwareSinging = micClarity > KEY_AWARE_CLARITY && isValidPitch && rms > KEY_AWARE_RMS_GATE;
  let keyAwareMidiPitch = isKeyAwareSinging ? 12 * Math.log2(micPitch / 440) + 69 : 0;
  const hasGuideNotes = state.playback.guideNotes && state.playback.guideNotes.length > 0;
  if (hasGuideNotes || state.playback.isMultiplexed && state.scoring.vocalGuideAnalyser) {
    let targetMidiPitch = 0;
    let isGuideNoteActive = false;
    if (hasGuideNotes) {
      const currentNote = state.playback.guideNotes.find(
        (n) => currentTime >= n.startTime && currentTime < n.startTime + n.duration
      );
      if (currentNote) {
        targetMidiPitch = currentNote.pitch;
        isGuideNoteActive = true;
      }
    } else {
      if (!guideAnalyserBuffer)
        guideAnalyserBuffer = new Float32Array(
          state.scoring.vocalGuideAnalyser.fftSize
        );
      state.scoring.vocalGuideAnalyser.getFloatTimeDomainData(
        guideAnalyserBuffer
      );
      const [guidePitch, guideClarity] = state.scoring.pitchDetector.findPitch(
        guideAnalyserBuffer,
        sampleRate
      );
      isGuideNoteActive = guideClarity >= GUIDE_CLARITY_THRESHOLD && guidePitch > 50;
      if (isGuideNoteActive) {
        targetMidiPitch = 12 * Math.log2(guidePitch / 440) + 69;
      }
    }
    const wasGuideNoteActive = state.scoring.isVocalGuideNoteActive;
    state.scoring.isVocalGuideNoteActive = isGuideNoteActive;
    if (isGuideNoteActive && !wasGuideNoteActive) {
      state.scoring.totalScorableNotes++;
      state.scoring.hasHitCurrentNote = false;
    }
    isCorrectPitch = false;
    if (isGuideNoteActive && isSinging) {
      let normalizedMicMidi = midiMicPitch;
      while (normalizedMicMidi < targetMidiPitch - 6) normalizedMicMidi += 12;
      while (normalizedMicMidi > targetMidiPitch + 6) normalizedMicMidi -= 12;
      if (Math.abs(normalizedMicMidi - targetMidiPitch) < 0.7) {
        isCorrectPitch = true;
      }
    }
    if (isCorrectPitch && !state.scoring.hasHitCurrentNote) {
      state.scoring.hasHitCurrentNote = true;
      state.scoring.notesHit++;
      if (pianoRollContainer && pianoRollContainer.elm.classList.contains("visible") && hasGuideNotes) {
        const currentNote = state.playback.guideNotes.find(
          (n) => currentTime >= n.startTime && currentTime < n.startTime + n.duration
        );
        if (currentNote) currentNote.hitStatus = "hit";
      }
    }
    if (state.scoring.totalScorableNotes > 0) {
      state.scoring.details.accuracy = Math.min(
        100,
        state.scoring.notesHit / state.scoring.totalScorableNotes * 100
      );
    }
    state.scoring.finalScore = state.scoring.details.accuracy;
  } else {
    state.scoring.frameCount++;
    if (state.scoring.frameCount % 3 === 0) {
      if (state.playback.isMidi) {
        for (let i = 0; i < 12; i++) {
          state.scoring.rollingChroma[i] *= 0.85;
        }
        for (const note of state.scoring.activeMidiNotes) {
          state.scoring.rollingChroma[note % 12] += 0.15;
        }
      } else if (state.scoring.meydaAnalyzer && typeof Meyda !== "undefined") {
        const features = state.scoring.meydaAnalyzer.get("chroma");
        if (features) {
          for (let i = 0; i < 12; i++) {
            state.scoring.rollingChroma[i] = state.scoring.rollingChroma[i] * 0.85 + features[i] * 0.15;
          }
        }
      }
      if (state.scoring.frameCount % 30 === 0) {
        const detected = detectMusicalKey(state.scoring.rollingChroma);
        if (detected.correlation > 0.3) {
          state.scoring.keyHistory.push(detected);
        } else {
          state.scoring.keyHistory.push({ name: "Unknown" });
        }
        if (state.scoring.keyHistory.length > 6) {
          state.scoring.keyHistory.shift();
        }
        const votes = {};
        let maxVotes = 0;
        let votedKey = null;
        let votedRoot = 0;
        let votedMode = "";
        for (const k of state.scoring.keyHistory) {
          if (k.name === "Unknown") continue;
          votes[k.name] = (votes[k.name] || 0) + 1;
          if (votes[k.name] > maxVotes) {
            maxVotes = votes[k.name];
            votedKey = k.name;
            votedRoot = k.root;
            votedMode = k.mode;
          }
        }
        if (votedKey) {
          if (!state.scoring.currentKeyName && maxVotes >= 2) {
            state.scoring.currentKeyName = votedKey;
            const intervals = votedMode === "Major" ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
            state.scoring.allowedPitchClasses = intervals.map(
              (interval) => (votedRoot + interval) % 12
            );
            console.log(
              `[FORTE SVC] \u{1F3B5} Initial Key Locked: ${votedKey} (${maxVotes}/6 votes)`
            );
          } else if (state.scoring.currentKeyName !== votedKey && maxVotes >= 4) {
            state.scoring.currentKeyName = votedKey;
            const intervals = votedMode === "Major" ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
            state.scoring.allowedPitchClasses = intervals.map(
              (interval) => (votedRoot + interval) % 12
            );
            console.log(
              `[FORTE SVC] \u{1F3B5} Key Modulation Confirmed: ${votedKey} (${maxVotes}/6 votes)`
            );
          }
        }
      }
    }
    if (isKeyAwareSinging && state.scoring.allowedPitchClasses.length > 0) {
      state.scoring.totalFramesSinging++;
      const pitchClass = Math.round(keyAwareMidiPitch) % 12;
      if (state.scoring.allowedPitchClasses.includes(pitchClass)) {
        state.scoring.framesInKey++;
      }
    }
    if (state.scoring.totalFramesSinging > 0) {
      const rawAccuracy = state.scoring.framesInKey / state.scoring.totalFramesSinging * 100;
      const participationMultiplier = Math.min(
        1,
        state.scoring.totalFramesSinging / MIN_FRAMES_FOR_FULL_SCORE
      );
      state.scoring.details.accuracy = rawAccuracy * participationMultiplier;
    } else {
      state.scoring.details.accuracy = 0;
    }
    state.scoring.finalScore = state.scoring.details.accuracy;
  }
  if (pianoRollContainer && pianoRollContainer.elm.classList.contains("visible")) {
    if (hasGuideNotes) {
      const currentNote = state.playback.guideNotes.find(
        (n) => currentTime >= n.startTime && currentTime < n.startTime + n.duration
      );
      if (currentNote) {
        if (isCorrectPitch) {
          currentNote.hitStatus = "hit";
        } else if (isSinging) {
          currentNote.hitStatus = "miss";
        }
      }
    }
  }
}
function timingLoop() {
  if (state.playback.status !== "playing") {
    animationFrameId = null;
    return;
  }
  const now = performance.now();
  let delta = (now - state.playback.lastFrameTime) / 1e3;
  if (delta > 0.1) delta = 0.1;
  state.playback.lastFrameTime = now;
  const engineState = pkg.data.getPlaybackState();
  const engineTime = engineState.currentTime;
  const duration = engineState.duration;
  let rate = 1;
  if (!state.playback.isMidi && sourceNode) {
    rate = sourceNode.playbackRate.value;
  }
  state.playback.smoothedTime += delta * rate;
  const drift = engineTime - state.playback.smoothedTime;
  if (Math.abs(drift) > 0.5) {
    state.playback.smoothedTime = engineTime;
  } else {
    state.playback.smoothedTime += drift * 0.15;
  }
  const currentTime = Math.max(
    0,
    Math.min(state.playback.smoothedTime, duration)
  );
  if (pianoRollContainer && pianoRollContainer.elm.classList.contains("visible")) {
    drawPianoRoll(currentTime);
  }
  if (state.scoring.enabled) {
    if (now - lastScoreTime > 33) {
      updateScore(currentTime);
      document.dispatchEvent(
        new CustomEvent("CherryTree.Forte.Scoring.Update", {
          detail: pkg.data.getScoringState()
        })
      );
      lastScoreTime = now;
    }
  }
  document.dispatchEvent(
    new CustomEvent("CherryTree.Forte.Playback.TimeUpdate", {
      detail: { currentTime, duration }
    })
  );
  if (state.scoring.enabled) {
    document.dispatchEvent(
      new CustomEvent("CherryTree.Forte.Scoring.Update", {
        detail: pkg.data.getScoringState()
      })
    );
  }
  if (engineTime >= duration && duration > 0) {
    animationFrameId = null;
    if (state.playback.status === "playing") {
      pkg.data.stopTrack();
    }
    return;
  }
  animationFrameId = requestAnimationFrame(timingLoop);
}
function renderPianoRollNotes(notes) {
  if (!pianoRollCanvas || !pianoRollContainer) return;
  drawPianoRoll(pkg.data.getPlaybackState().currentTime);
}
function drawPianoRoll(currentTime) {
  if (!pianoRollCanvas || !pianoRollCtx || !pianoRollContainer) return;
  const canvas = pianoRollCanvas.elm;
  const ctx = pianoRollCtx;
  const expectedWidth = cachedPianoWidth;
  if (canvas.width !== expectedWidth) canvas.width = expectedWidth;
  if (canvas.height !== 250) canvas.height = 250;
  const width = canvas.width;
  const height = canvas.height;
  if (width === 0 || height === 0) return;
  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  const numGridLines = 8;
  ctx.beginPath();
  for (let i = 1; i < numGridLines; i++) {
    const lineY = height / numGridLines * i;
    ctx.moveTo(0, lineY);
    ctx.lineTo(width, lineY);
  }
  ctx.stroke();
  const notes = state.playback.guideNotes || [];
  const PRE_ROLL_SECONDS = 2.5;
  let firstNoteTime = 0;
  if (notes.length > 0) {
    firstNoteTime = notes[0].startTime;
  }
  const globalOffset = Math.max(0, firstNoteTime - PRE_ROLL_SECONDS);
  const adjustedTime = currentTime - globalOffset;
  const PAGE_DURATION = width / PIXELS_PER_SECOND;
  const pageIndex = Math.floor(Math.max(0, adjustedTime) / PAGE_DURATION);
  const pageAdjustedStartTime = pageIndex * PAGE_DURATION;
  const pageRealStartTime = pageAdjustedStartTime + globalOffset;
  const pageRealEndTime = pageRealStartTime + PAGE_DURATION;
  const playheadX = (adjustedTime - pageAdjustedStartTime) * PIXELS_PER_SECOND;
  const minMidi = state.playback.guideRange?.min ?? 42;
  const maxMidi = state.playback.guideRange?.max ?? 90;
  const rangeDiff = Math.max(1, maxMidi - minMidi);
  const NOTE_HEIGHT = 16;
  const pitchToY = (pitch) => {
    if (pitch < minMidi) return height;
    if (pitch > maxMidi) return 0;
    const normalized = (pitch - minMidi) / rangeDiff;
    return height - normalized * height;
  };
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    if (note.startTime + note.duration < pageRealStartTime) continue;
    if (note.startTime > pageRealEndTime) break;
    const startX = (note.startTime - pageRealStartTime) * PIXELS_PER_SECOND;
    const noteWidth = Math.max(note.duration * PIXELS_PER_SECOND, 8);
    const y = pitchToY(note.pitch);
    if (!isFinite(startX) || !isFinite(y) || !isFinite(noteWidth)) continue;
    const isActive = playheadX >= startX && playheadX <= startX + noteWidth;
    const grad = ctx.createLinearGradient(
      0,
      y - NOTE_HEIGHT / 2,
      0,
      y + NOTE_HEIGHT / 2
    );
    if (note.hitStatus === "hit") {
      grad.addColorStop(0, "#a3e635");
      grad.addColorStop(1, "#4d7c0f");
      ctx.shadowColor = "#a3e635";
      ctx.shadowBlur = isActive ? 15 : 5;
    } else if (note.hitStatus === "miss") {
      grad.addColorStop(0, "#fca5a5");
      grad.addColorStop(1, "#991b1b");
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
    } else {
      grad.addColorStop(0, "#7dd3fc");
      grad.addColorStop(1, "#0284c7");
      ctx.shadowColor = "#38bdf8";
      ctx.shadowBlur = isActive ? 10 : 0;
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(
        startX,
        y - NOTE_HEIGHT / 2,
        noteWidth,
        NOTE_HEIGHT,
        NOTE_HEIGHT / 2
      );
    } else {
      ctx.rect(startX, y - NOTE_HEIGHT / 2, noteWidth, NOTE_HEIGHT);
    }
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(
        startX + 2,
        y - NOTE_HEIGHT / 2 + 1,
        noteWidth - 4,
        NOTE_HEIGHT / 3,
        3
      );
    } else {
      ctx.rect(
        startX + 2,
        y - NOTE_HEIGHT / 2 + 1,
        noteWidth - 4,
        NOTE_HEIGHT / 3
      );
    }
    ctx.fill();
    if (isActive && note.hitStatus === "hit" && state.scoring.isSinging) {
      const sparkGrad = ctx.createRadialGradient(
        playheadX,
        y,
        0,
        playheadX,
        y,
        20
      );
      sparkGrad.addColorStop(0, "rgba(255, 255, 255, 1)");
      sparkGrad.addColorStop(0.3, "rgba(163, 230, 53, 0.8)");
      sparkGrad.addColorStop(1, "rgba(163, 230, 53, 0)");
      ctx.fillStyle = sparkGrad;
      ctx.fillRect(playheadX - 20, y - 20, 40, 40);
    }
  }
  if (playheadX >= 0) {
    const sweepWidth = 120;
    const sweepGrad = ctx.createLinearGradient(
      playheadX - sweepWidth,
      0,
      playheadX,
      0
    );
    sweepGrad.addColorStop(0, "transparent");
    sweepGrad.addColorStop(1, "rgba(255, 215, 0, 0.15)");
    ctx.fillStyle = sweepGrad;
    ctx.fillRect(playheadX - sweepWidth, 0, sweepWidth, height);
    ctx.fillStyle = "#ffd700";
    ctx.shadowColor = "#ffd700";
    ctx.shadowBlur = 15;
    ctx.fillRect(playheadX - 1, 0, 2, height);
    ctx.shadowBlur = 0;
  }
  if (state.scoring.isSinging && state.scoring.currentMicMidi > 0 && playheadX >= 0) {
    const userY = pitchToY(state.scoring.currentMicMidi);
    if (isFinite(userY)) {
      const time = performance.now();
      const pulse = Math.sin(time / 100) * 3;
      ctx.beginPath();
      ctx.arc(playheadX, userY, 12 + pulse, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(137, 207, 240, 0.3)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(playheadX, userY, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "#38bdf8";
      ctx.shadowBlur = 15;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(playheadX, userY, 8, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}
function startIncrementalGuideAnalysis(audioBuffer) {
  console.log("[FORTE SVC] Starting incremental analysis for piano roll...");
  state.playback.isAnalyzing = true;
  const channelData = audioBuffer.getChannelData(1);
  const sampleRate = audioBuffer.sampleRate;
  const bufferSize = 2048;
  const detector = PitchDetector.forFloat32Array(bufferSize);
  const minNoteDuration = 0.08;
  const stepSize = 1024;
  let noteIdCounter = state.playback.guideNotes.length;
  let analysisPosition = 0;
  const analysisChunkDurationS = 2;
  const analysisChunkSamples = analysisChunkDurationS * sampleRate;
  let currentNote = null;
  function processChunk() {
    if (!state.playback.isAnalyzing) {
      console.log("[FORTE SVC] Incremental analysis stopped.");
      return;
    }
    const chunkEndPosition = Math.min(
      analysisPosition + analysisChunkSamples,
      channelData.length - bufferSize
    );
    const foundNotes = [];
    const dataLen = channelData.length;
    for (let i = analysisPosition; i < chunkEndPosition; i += stepSize) {
      const chunk = channelData.subarray(i, i + bufferSize);
      const [pitch, clarity] = detector.findPitch(chunk, sampleRate);
      const time = i / sampleRate;
      const midiPitch = 12 * Math.log2(pitch / 440) + 69;
      const isNoteActive = clarity > GUIDE_CLARITY_THRESHOLD && pitch >= MIN_VOCAL_HZ && pitch <= MAX_VOCAL_HZ && midiPitch >= 0 && midiPitch < 128;
      if (isNoteActive) {
        if (!currentNote) {
          currentNote = {
            midi: midiPitch,
            startTime: time,
            pitches: [midiPitch]
          };
        } else {
          currentNote.pitches.push(midiPitch);
        }
      } else if (currentNote) {
        const duration = time - currentNote.startTime;
        if (duration > minNoteDuration) {
          let pSum = 0;
          const pLen = currentNote.pitches.length;
          for (let k = 0; k < pLen; k++) pSum += currentNote.pitches[k];
          foundNotes.push({
            id: noteIdCounter++,
            pitch: pSum / pLen,
            startTime: currentNote.startTime,
            duration
          });
        }
        currentNote = null;
      }
    }
    if (foundNotes.length > 0) {
      const lastGlobalNote = state.playback.guideNotes[state.playback.guideNotes.length - 1];
      const firstChunkNote = foundNotes[0];
      if (lastGlobalNote && firstChunkNote.startTime - (lastGlobalNote.startTime + lastGlobalNote.duration) < 0.05 && Math.abs(firstChunkNote.pitch - lastGlobalNote.pitch) < 1) {
        lastGlobalNote.duration = firstChunkNote.startTime + firstChunkNote.duration - lastGlobalNote.startTime;
        foundNotes.shift();
      }
      state.playback.guideNotes.push(...foundNotes);
      renderPianoRollNotes(foundNotes);
    }
    analysisPosition = chunkEndPosition;
    if (analysisPosition < dataLen - bufferSize) {
      setTimeout(processChunk, 16);
    } else {
      if (currentNote) {
        const time = (dataLen - 1) / sampleRate;
        const duration = time - currentNote.startTime;
        if (duration > minNoteDuration) {
          let pSum = 0;
          const pLen = currentNote.pitches.length;
          for (let k = 0; k < pLen; k++) pSum += currentNote.pitches[k];
          const finalNote = {
            id: noteIdCounter++,
            pitch: pSum / pLen,
            startTime: currentNote.startTime,
            duration
          };
          state.playback.guideNotes.push(finalNote);
          renderPianoRollNotes([finalNote]);
        }
      }
      state.playback.isAnalyzing = false;
      logVerbose("Incremental guide analysis complete.");
    }
  }
  setTimeout(processChunk, 16);
}
var pkg = {
  name: "Forte Sound Engine Service",
  svcName: "ForteSvc",
  type: "svc",
  privs: 0,
  /**
   * Instantiates global audio contexts and pipeline nodes.
   *
   * @param {Object} Root - Global Application object.
   */
  start: async function(Root) {
    logVerbose("Starting Forte Sound Engine Service for Encore.");
    root = Root;
    pianoRollContainer = new Html("div").classOn("forte-piano-roll-container").appendTo("body");
    pianoRollCanvas = new Html("canvas").classOn("forte-piano-roll-canvas").appendTo(pianoRollContainer);
    pianoRollCtx = pianoRollCanvas.elm.getContext("2d");
    cachedPianoWidth = window.innerWidth;
    window.addEventListener("resize", () => {
      if (pianoRollCanvas && pianoRollContainer) {
        cachedPianoWidth = pianoRollContainer.elm.clientWidth || window.innerWidth;
        pianoRollCanvas.elm.width = cachedPianoWidth;
        pianoRollCanvas.elm.height = 250;
        if (state.playback.status !== "playing" && pkg.data) {
          drawPianoRoll(pkg.data.getPlaybackState().currentTime);
        }
      }
    });
    try {
      const config = await window.config.getAll();
      const bufferSize = config.audioConfig?.bufferSize ?? 0.1;
      audioContext = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: bufferSize,
        sampleRate: 44100
      });
      masterGain = audioContext.createGain();
      sfxGain = audioContext.createGain();
      masterCompressor = audioContext.createDynamicsCompressor();
      masterCompressor.threshold.setValueAtTime(-24, audioContext.currentTime);
      masterCompressor.knee.setValueAtTime(40, audioContext.currentTime);
      masterCompressor.ratio.setValueAtTime(4, audioContext.currentTime);
      masterCompressor.attack.setValueAtTime(0.01, audioContext.currentTime);
      masterCompressor.release.setValueAtTime(0.25, audioContext.currentTime);
      masterGain.connect(masterCompressor);
      masterCompressor.connect(audioContext.destination);
      sfxGain.connect(audioContext.destination);
      sfxGain.gain.value = state.playback.volume;
      state.recording.destinationNode = audioContext.createMediaStreamDestination();
      state.recording.audioStream = state.recording.destinationNode.stream;
      state.recording.micDestinationNode = audioContext.createMediaStreamDestination();
      state.recording.musicDestinationNode = audioContext.createMediaStreamDestination();
      state.recording.micAudioStream = state.recording.micDestinationNode.stream;
      state.recording.musicAudioStream = state.recording.musicDestinationNode.stream;
      state.effects.micChainInput = audioContext.createGain();
      state.effects.micChainOutput = audioContext.createGain();
      state.effects.micChainInput.connect(state.effects.micChainOutput);
      state.effects.micChainOutput.connect(state.recording.destinationNode);
      state.effects.micChainOutput.connect(state.recording.micDestinationNode);
      state.playback.midiGain = audioContext.createGain();
      state.playback.midiGain.connect(masterGain);
      state.scoring.musicAnalyser = audioContext.createAnalyser();
      state.scoring.musicAnalyser.fftSize = 2048;
      state.playback.midiGain.connect(state.scoring.musicAnalyser);
      logVerbose("Audio pipelines initialized.");
      logVerbose("AudioContext sinkId", audioContext.sinkId || "default");
      logVerbose("AudioContext baseLatency", audioContext.baseLatency);
      logVerbose("AudioContext outputLatency", audioContext.outputLatency);
      logVerbose(
        "AudioContext total latency",
        audioContext.baseLatency + audioContext.outputLatency
      );
      state.playback.currentDeviceId = audioContext.sinkId || "default";
      pkg.data.getPlaybackDevices();
      try {
        await audioContext.audioWorklet.addModule(
          "/libs/spessasynth_lib/dist/spessasynth_processor.min.js"
        );
        const soundFontUrl = "/libs/soundfonts/SAM2695.sf2";
        const soundFontBuffer = await (await fetch(soundFontUrl)).arrayBuffer();
        state.playback.synthesizer = new WorkletSynthesizer(audioContext);
        await state.playback.synthesizer.soundBankManager.addSoundBank(
          soundFontBuffer
        );
        state.playback.synthesizer.connect(state.playback.midiGain);
        console.log("[FORTE SVC] MIDI Synthesizer initialized successfully.");
      } catch (synthError) {
        console.error(
          "[FORTE SVC] FATAL: Could not initialize MIDI Synthesizer.",
          synthError
        );
        state.playback.synthesizer = null;
      }
    } catch (e) {
      console.error("[FORTE SVC] FATAL: Web Audio API is not supported.", e);
    }
    await pkg.data.initializeScoringEngine();
  },
  data: {
    /**
     * Retrieves the continuous stream containing both mixed mic and music lines.
     *
     * @returns {MediaStream} Real-time audio stream output.
     */
    getRecordingAudioStream: () => {
      return state.recording.audioStream;
    },
    /**
     * Retrieves the continuous stream containing the mic stream.
     *
     * @returns {MediaStream} Real-time audio stream output.
     */
    getMicAudioStream: () => {
      return state.recording.micAudioStream;
    },
    /**
     * Retrieves the continuous stream containing the music stream.
     *
     * @returns {MediaStream} Real-time audio stream output.
     */
    getMusicAudioStream: () => {
      return state.recording.musicAudioStream;
    },
    /**
     * Loads a short sound effect into the global buffer cache.
     *
     * @param {string} url - Audio endpoint.
     * @returns {Promise<boolean>} True if loaded.
     */
    loadSfx: async (url) => {
      if (!audioContext) return false;
      if (sfxCache.has(url)) return true;
      try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const isMidi = url.toLowerCase().endsWith(".mid") || url.toLowerCase().endsWith(".midi") || url.toLowerCase().endsWith(".kar");
        if (isMidi) {
          sfxCache.set(url, { isMidi: true, buffer: arrayBuffer });
          return true;
        }
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        sfxCache.set(url, { isMidi: false, buffer: audioBuffer });
        return true;
      } catch (e) {
        console.error(`[FORTE SVC] Failed to load SFX: ${url}`, e);
        return false;
      }
    },
    /**
     * Fires a previously cached sound effect immediately.
     * Resolves when the effect has fully completed playing.
     *
     * @param {string} url - Target URL matching the cache dictionary.
     * @param {number} [volume=1] - Optional volume multiplier from 0.0 to 1.0 for this specific play.
     * @returns {Promise<boolean>} Resolves to true when completed naturally, false if interrupted.
     */
    playSfx: async (url, volume = 1) => {
      await pkg.data.stopSfx();
      return new Promise(async (resolve) => {
        if (!audioContext) return resolve(false);
        if (audioContext.state === "suspended") await audioContext.resume();
        let cached = sfxCache.get(url);
        if (!cached) {
          const success = await pkg.data.loadSfx(url);
          if (!success) return resolve(false);
          cached = sfxCache.get(url);
        }
        const clampedVolume = Math.max(0, Math.min(1, volume));
        if (cached) {
          sfxResolve = resolve;
          if (cached.isMidi) {
            if (!state.playback.synthesizer || !state.playback.midiGain)
              return resolve(false);
            sfxMidiOriginalVolume = state.playback.midiGain.gain.value;
            const sfxTargetVolume = state.playback.volume * state.playback.sfxVolume * clampedVolume;
            state.playback.midiGain.gain.setTargetAtTime(
              sfxTargetVolume,
              audioContext.currentTime,
              0.01
            );
            sfxSequencer = new Sequencer(state.playback.synthesizer);
            sfxSequencer.loop = false;
            let sfxMidiData;
            try {
              sfxMidiData = BasicMIDI.fromArrayBuffer(cached.buffer);
            } catch (e) {
              sfxMidiData = { binary: cached.buffer };
            }
            sfxSequencer.loadNewSongList([sfxMidiData]);
            sfxSequencer.play();
            bindSpessaEvent(
              sfxSequencer.eventHandler,
              "songEnded",
              "forte-sfx-end",
              () => {
                if (sfxMidiOriginalVolume !== null && state.playback.midiGain) {
                  state.playback.midiGain.gain.setTargetAtTime(
                    sfxMidiOriginalVolume,
                    audioContext.currentTime,
                    0.01
                  );
                  sfxMidiOriginalVolume = null;
                }
                if (sfxResolve) {
                  sfxResolve(true);
                  sfxResolve = null;
                }
                if (sfxSequencer) {
                  try {
                    sfxSequencer.pause();
                  } catch (e) {
                  }
                  sfxSequencer = null;
                }
              }
            );
          } else {
            sfxSourceNode = audioContext.createBufferSource();
            sfxSourceNode.buffer = cached.buffer;
            const sfxIndividualGain = audioContext.createGain();
            sfxIndividualGain.gain.value = clampedVolume;
            sfxSourceNode.connect(sfxIndividualGain);
            sfxIndividualGain.connect(sfxGain);
            sfxSourceNode.onended = () => {
              if (sfxResolve) {
                sfxResolve(true);
                sfxResolve = null;
              }
            };
            sfxSourceNode.start(0);
          }
        } else {
          resolve(false);
        }
      });
    },
    /**
     * Stops sound effect
     */
    stopSfx: async () => {
      if (sfxSourceNode) {
        sfxSourceNode.onended = null;
        sfxSourceNode.stop();
        sfxSourceNode = null;
      }
      if (sfxSequencer) {
        try {
          sfxSequencer.pause();
        } catch (e) {
        }
        try {
          sfxSequencer.currentTime = 0;
        } catch (e) {
        }
        sfxSequencer = null;
        if (sfxMidiOriginalVolume !== null && state.playback.midiGain) {
          state.playback.midiGain.gain.setTargetAtTime(
            sfxMidiOriginalVolume,
            audioContext.currentTime,
            0.01
          );
          sfxMidiOriginalVolume = null;
        }
      }
      if (sfxResolve) {
        sfxResolve(false);
        sfxResolve = null;
      }
    },
    /**
     * Retrieves available hardware output devices mapping them to system identifiers.
     *
     * @returns {Promise<Array<{deviceId: string, label: string}>>} List of detected output pairs.
     */
    getPlaybackDevices: async () => {
      if (!navigator.mediaDevices?.enumerateDevices) return [];
      try {
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const audioOutputs = allDevices.filter((device) => device.kind === "audiooutput").map((device) => ({
          deviceId: device.deviceId,
          label: device.label || `Output Device ${device.deviceId.substring(0, 8)}`
        }));
        state.playback.devices = audioOutputs;
        return audioOutputs;
      } catch (e) {
        return [];
      }
    },
    /**
     * Points audio graph out towards a specific hardware boundary via API.
     *
     * @param {string} deviceId - Local device token.
     * @returns {Promise<boolean>} Indication of success mapping out.
     */
    setPlaybackDevice: async (deviceId) => {
      if (!audioContext || typeof audioContext.setSinkId !== "function")
        return false;
      try {
        await audioContext.setSinkId(deviceId);
        state.playback.currentDeviceId = deviceId;
        logVerbose("Playback device set", deviceId);
        dispatchPlaybackUpdate();
        return true;
      } catch (e) {
        return false;
      }
    },
    /**
     * Sets the container element for piano roll UI components.
     * Moves the piano roll elements from their current parent to the specified container.
     *
     * @param {HTMLElement|string} containerSelector - DOM element or CSS selector string.
     * @returns {boolean} True if successfully moved, false if container not found.
     */
    setPianoRollContainer: (containerSelector) => {
      try {
        let container;
        if (typeof containerSelector === "string") {
          container = Html.qs(containerSelector);
        } else {
          container = containerSelector;
        }
        if (!container) {
          console.error(
            "[FORTE SVC] Invalid piano roll container",
            containerSelector
          );
          return false;
        }
        if (pianoRollContainer) {
          pianoRollContainer.appendTo(container);
          logVerbose("Piano roll container moved", container.elm);
        }
        return true;
      } catch (e) {
        console.error("[FORTE SVC] Failed to move piano roll container:", e);
        return false;
      }
      return false;
    },
    /**
     * Determines CSS layout presentation showing the pitch mapping visualization layer.
     *
     * @param {boolean} bool - True enforcing visible traits.
     */
    togglePianoRollVisibility: async (bool) => {
      state.ui.pianoRollVisible = bool;
      if (bool && pianoRollContainer) {
        pianoRollContainer.classOn("visible");
      } else if (pianoRollContainer) {
        pianoRollContainer.classOff("visible");
      }
    },
    /**
     * Replaces the running default soundfont buffer used in SpessaSynth.
     *
     * @param {string} url - Target SF2 endpoint structure URL.
     * @returns {Promise<boolean>} True indicating the buffer rebuilt completely.
     */
    loadSoundFont: async (url) => {
      if (!audioContext) return false;
      if (state.playback.status !== "stopped") {
        pkg.data.stopTrack();
      }
      logVerbose(`Swapping SoundBank with: ${url}`);
      try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        if (state.playback.synthesizer) {
          state.playback.synthesizer.disconnect();
          state.playback.synthesizer = null;
        }
        state.playback.synthesizer = new WorkletSynthesizer(audioContext);
        await state.playback.synthesizer.soundBankManager.addSoundBank(
          arrayBuffer
        );
        state.playback.synthesizer.connect(state.playback.midiGain);
        if (state.playback.transpose !== 0) {
          state.playback.synthesizer.setMasterParameter(
            "transposition",
            state.playback.transpose
          );
        }
        logVerbose("New SoundBank loaded and Synthesizer recreated.");
        return true;
      } catch (e) {
        console.error(`[FORTE SVC] Failed to load custom SoundBank: ${url}`, e);
        return false;
      }
    },
    /**
     * Primary load sequencer formatting tracks and establishing variables specific to decoding contexts.
     *
     * @param {string} url - The targeted local media.
     * @returns {Promise<boolean>} True if all media segments parsed cleanly.
     */
    loadTrack: async (url) => {
      if (!audioContext) return false;
      if (state.playback.status !== "stopped") pkg.data.stopTrack();
      if (state.playback.sequencer) {
        try {
          state.playback.sequencer.pause();
        } catch (e) {
        }
        try {
          state.playback.sequencer.currentTime = 0;
        } catch (e) {
        }
        state.playback.sequencer = null;
      }
      state.playback.midiInfo = {
        ticks: [],
        timeDivision: 480,
        tempoChanges: [],
        initialBpm: 120,
        keyRange: { min: 0, max: 127 }
      };
      state.playback.decodedLyrics = [];
      state.playback.lyricsEncoding = "utf-8";
      state.playback.transpose = 0;
      state.playback.isMultiplexed = false;
      state.playback.multiplexPan = -1;
      state.playback.guideNotes = [];
      state.playback.guideRange = { min: 42, max: 90 };
      state.playback.isAnalyzing = false;
      state.scoring.activeMidiNotes.clear();
      if (pianoRollContainer) pianoRollContainer.classOff("visible");
      const isMidi = url.toLowerCase().endsWith(".mid") || url.toLowerCase().endsWith(".midi") || url.toLowerCase().endsWith(".kar");
      state.playback.isMidi = isMidi;
      if (!isMidi && url.toLowerCase().includes(".multiplexed.")) {
        state.playback.isMultiplexed = true;
      }
      logVerbose("Preparing to load track", {
        url,
        isMidi,
        isMultiplexed: state.playback.isMultiplexed
      });
      try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        if (isMidi) {
          if (!state.playback.synthesizer)
            throw new Error("MIDI Synthesizer not ready.");
          let parsedMidi;
          try {
            parsedMidi = BasicMIDI.fromArrayBuffer(arrayBuffer);
          } catch (e) {
            console.error("[FORTE SVC] BasicMIDI parsing failed:", e);
            throw e;
          }
          logVerbose("Notes", parsedMidi.getNoteTimes());
          state.playback.sequencer = new Sequencer(state.playback.synthesizer);
          state.playback.sequencer.loop = false;
          bindSpessaEvent(
            state.playback.sequencer.eventHandler,
            "songEnded",
            "forte-song-end",
            () => {
              if (state.playback.status !== "stopped") pkg.data.stopTrack();
            }
          );
          logVerbose("Sequencer loaded", state.playback.sequencer);
          logVerbose("Synthesizer", state.playback.synthesizer);
          for (const channel of state.playback.synthesizer.midiChannels || []) {
            console.log("Midi channel", channel);
          }
          bindSpessaEvent(
            state.playback.synthesizer.eventHandler,
            "noteOn",
            "forte-note-on",
            (e) => {
              const isDrum = state.playback.synthesizer.midiChannels ? state.playback.synthesizer.midiChannels[e.channel]?.preset?.isGMGSDrum ?? state.playback.synthesizer.midiChannels[e.channel]?.isDrum ?? e.channel === 9 : e.channel === 9;
              if (!isDrum) {
                if (e.velocity > 0) {
                  state.scoring.activeMidiNotes.add(e.midiNote);
                } else {
                  state.scoring.activeMidiNotes.delete(e.midiNote);
                }
              }
            }
          );
          bindSpessaEvent(
            state.playback.synthesizer.eventHandler,
            "noteOff",
            "forte-note-off",
            (e) => {
              const isDrum = state.playback.synthesizer.midiChannels ? state.playback.synthesizer.midiChannels[e.channel]?.preset?.isGMGSDrum ?? state.playback.synthesizer.midiChannels[e.channel]?.isDrum ?? e.channel === 9 : e.channel === 9;
              if (!isDrum) {
                state.scoring.activeMidiNotes.delete(e.midiNote);
              }
            }
          );
          let displayableLyricIndex = 0;
          bindSpessaEvent(
            state.playback.sequencer.eventHandler,
            "metaEvent",
            "forte-meta",
            (e) => {
              if (state.playback.status === "stopped") return;
              if (!e || !e.event) return;
              const dataArray = e.event.data;
              if (!dataArray || !(dataArray instanceof Uint8Array)) return;
              const text = new TextDecoder(
                state.playback.lyricsEncoding
              ).decode(dataArray);
              const cleanText = text.replace(/[\r\n\/\\]/g, "");
              if (cleanText && cleanText == "@IENCOREDUET") {
                logVerbose("This is a duet");
                document.dispatchEvent(
                  new CustomEvent("CherryTree.Forte.Playback.DuetDetected")
                );
              }
              if (cleanText && !cleanText.startsWith("@") && !cleanText.startsWith("#")) {
                let isVerifiedLyric = false;
                const maxLookahead = Math.min(
                  displayableLyricIndex + 5,
                  state.playback.decodedLyrics.length
                );
                for (let i = displayableLyricIndex; i < maxLookahead; i++) {
                  const expectedClean = state.playback.decodedLyrics[i].replace(
                    /[\r\n\/\\]/g,
                    ""
                  );
                  if (cleanText === expectedClean) {
                    isVerifiedLyric = true;
                    displayableLyricIndex = i;
                    break;
                  }
                }
                if (isVerifiedLyric) {
                  displayableLyricIndex++;
                } else {
                  logVerbose("Ignored non-lyric meta event:", cleanText);
                }
              }
            }
          );
          state.playback.sequencer.loadNewSongList([parsedMidi]);
          const rawLyrics = parsedMidi.lyrics || [];
          state.playback.midiInfo = {
            ticks: rawLyrics.map((msg) => msg.ticks).filter((t) => t !== void 0),
            timeDivision: parsedMidi.timeDivision || 480,
            tempoChanges: parsedMidi.tempoChanges || [],
            initialBpm: 120,
            keyRange: parsedMidi.keyRange || { min: 0, max: 127 }
          };
          if (parsedMidi.tempoChanges && parsedMidi.tempoChanges.length > 0) {
            state.playback.midiInfo.initialBpm = Math.round(
              parsedMidi.tempoChanges[0].tempo || 120
            );
          }
          if (rawLyrics.length > 0) {
            const lyricTimes = rawLyrics.filter((l) => l.ticks !== void 0).map((l) => parsedMidi.midiTicksToSeconds(l.ticks));
            if (lyricTimes.length > 5) {
              const channels = parsedMidi.getNoteTimes();
              const candidateChannels = [];
              for (let i = 0; i < 16; i++) {
                if (i === 9) continue;
                const notes = channels[i];
                if (!notes || notes.length === 0) continue;
                if (notes.length < lyricTimes.length * 0.3) continue;
                if (notes.length > lyricTimes.length * 4) continue;
                let chordNotes = 0;
                for (let n = 1; n < notes.length; n++) {
                  if (Math.abs(notes[n].start - notes[n - 1].start) < 0.05) {
                    chordNotes++;
                  }
                }
                const polyphonyRatio = chordNotes / notes.length;
                if (polyphonyRatio > 0.25) continue;
                let matches = 0;
                let pitchSum = 0;
                for (const lTime of lyricTimes) {
                  if (notes.some((n) => Math.abs(n.start - lTime) < 0.1)) {
                    matches++;
                  }
                }
                const matchRatio = matches / lyricTimes.length;
                notes.forEach((n) => pitchSum += n.midiNote);
                const avgPitch = pitchSum / notes.length;
                let pitchPenalty = 0;
                if (avgPitch < 50) pitchPenalty = (50 - avgPitch) * 0.15;
                if (avgPitch > 85) pitchPenalty = (avgPitch - 85) * 0.15;
                const score = matchRatio - polyphonyRatio * 1.5 - pitchPenalty;
                candidateChannels.push({
                  index: i,
                  notes,
                  matchRatio,
                  polyphonyRatio,
                  avgPitch,
                  score
                });
              }
              candidateChannels.sort((a, b) => b.score - a.score);
              if (candidateChannels.length > 0 && candidateChannels[0].matchRatio > 0.15) {
                const mainChannel = candidateChannels[0];
                const validChannels = [mainChannel];
                logVerbose(
                  `\u{1F3B5} Primary Vocal Guide on Channel ${mainChannel.index + 1} (Score: ${mainChannel.score.toFixed(2)}, Match: ${(mainChannel.matchRatio * 100).toFixed(1)}%)`
                );
                for (let i = 1; i < candidateChannels.length; i++) {
                  const candidate = candidateChannels[i];
                  if (mainChannel.score - candidate.score > 0.6) continue;
                  if (candidate.matchRatio < 0.15) continue;
                  if (Math.abs(mainChannel.avgPitch - candidate.avgPitch) > 18)
                    continue;
                  let overlapCount = 0;
                  for (const n1 of candidate.notes) {
                    for (const n2 of mainChannel.notes) {
                      const n1End = n1.start + n1.length;
                      const n2End = n2.start + n2.length;
                      if (n1.start < n2End && n1End > n2.start) {
                        overlapCount++;
                        break;
                      }
                    }
                  }
                  const overlapRatio = overlapCount / candidate.notes.length;
                  if (overlapRatio < 0.2) {
                    logVerbose(
                      `\u{1F517} Merging Channel ${candidate.index + 1} as split melody (Overlap: ${(overlapRatio * 100).toFixed(1)}%)`
                    );
                    validChannels.push(candidate);
                  }
                }
                let combinedNotes = [];
                validChannels.forEach((c) => {
                  combinedNotes.push(...c.notes);
                });
                combinedNotes.sort((a, b) => a.start - b.start);
                const monoNotes = [];
                let minPitch = 127;
                let maxPitch = 0;
                combinedNotes.forEach((n) => {
                  const duration = Math.max(n.length, 0.1);
                  const existing = monoNotes.find(
                    (mn) => Math.abs(mn.startTime - n.start) < 0.05
                  );
                  if (existing) {
                    if (n.midiNote > existing.pitch)
                      existing.pitch = n.midiNote;
                  } else {
                    monoNotes.push({
                      id: monoNotes.length,
                      pitch: n.midiNote,
                      startTime: n.start,
                      duration
                    });
                  }
                  if (n.midiNote < minPitch) minPitch = n.midiNote;
                  if (n.midiNote > maxPitch) maxPitch = n.midiNote;
                });
                state.playback.guideNotes = monoNotes;
                state.playback.guideRange = {
                  min: Math.max(0, minPitch - 4),
                  max: Math.min(127, maxPitch + 4)
                };
              } else {
                logVerbose(
                  "\u26A0\uFE0F No clear vocal guide track found. Falling back to Key-Aware Scoring."
                );
              }
            }
          }
          if (rawLyrics.length > 0) {
            const totalLength = rawLyrics.reduce(
              (acc, val) => acc + (val.data ? val.data.byteLength : 0),
              0
            );
            const combinedBuffer = new Uint8Array(totalLength);
            let offset = 0;
            for (const message of rawLyrics) {
              if (message.data) {
                combinedBuffer.set(message.data, offset);
                offset += message.data.byteLength;
              }
            }
            state.playback.lyricsEncoding = detectEncoding(combinedBuffer);
            const decoder = new TextDecoder(state.playback.lyricsEncoding);
            state.playback.decodedLyrics = rawLyrics.map(
              (message) => message.data ? decoder.decode(message.data) : ""
            ).map((text) => text.replace(/[\/\\]/g, "\n")).filter((text) => {
              const clean = text.replace(/[\r\n\/\\]/g, "");
              return !clean.startsWith("@") && !clean.startsWith("#");
            });
          } else {
            state.playback.lyricsEncoding = "utf-8";
          }
          state.playback.buffer = null;
        } else {
          state.playback.buffer = await audioContext.decodeAudioData(arrayBuffer);
          if (state.playback.isMultiplexed) {
            startIncrementalGuideAnalysis(state.playback.buffer);
          }
        }
        state.playback.status = "stopped";
        state.playback.pauseTime = 0;
        logVerbose(`Track loaded: ${url}`);
        dispatchPlaybackUpdate();
        return true;
      } catch (e) {
        console.error(`[FORTE SVC] Failed to load track: ${url}`, e);
        return false;
      }
    },
    /**
     * Executes loaded node timelines beginning progression logic and sound routing.
     */
    playTrack: () => {
      if (audioContext.state === "suspended") audioContext.resume();
      if (state.recording.destinationNode) {
        state.recording.trackDelayNode = audioContext.createDelay();
        const recordingGain = audioContext.createGain();
        recordingGain.gain.value = state.effects.musicGainInRecording;
        state.recording.musicRecordingGainNode = recordingGain;
        state.recording.trackDelayNode.delayTime.value = state.scoring.measuredLatencyS;
        state.recording.trackDelayNode.connect(recordingGain);
        recordingGain.connect(state.recording.destinationNode);
        recordingGain.connect(state.recording.musicDestinationNode);
      }
      state.scoring.enabled = true;
      logVerbose("Track playback starting", {
        isMidi: state.playback.isMidi,
        isMultiplexed: state.playback.isMultiplexed,
        bufferDuration: state.playback.buffer?.duration
      });
      Object.assign(state.scoring, {
        finalScore: 0,
        totalScorableNotes: 0,
        notesHit: 0,
        isVocalGuideNoteActive: false,
        hasHitCurrentNote: false,
        totalFramesSinging: 0,
        framesInKey: 0,
        rollingChroma: new Array(12).fill(0),
        currentKeyName: null,
        allowedPitchClasses: [],
        keyHistory: [],
        frameCount: 0,
        activeMidiNotes: /* @__PURE__ */ new Set(),
        details: { accuracy: 0 }
      });
      if (state.playback.isMidi) {
        if (!state.playback.sequencer || state.playback.status === "playing")
          return;
        if (state.recording.trackDelayNode && state.playback.midiGain) {
          state.playback.midiGain.connect(state.recording.trackDelayNode);
        }
        if (state.playback.guideNotes && state.playback.guideNotes.length > 0) {
          renderPianoRollNotes(state.playback.guideNotes);
          if (state.ui.pianoRollVisible && pianoRollContainer) {
            pianoRollContainer.classOn("visible");
          }
        } else {
          if (pianoRollContainer) pianoRollContainer.classOff("visible");
        }
        state.playback.sequencer.currentTime = 0;
        state.playback.sequencer.play();
        state.playback.status = "playing";
      } else {
        if (!state.playback.buffer || state.playback.status === "playing")
          return;
        sourceNode = audioContext.createBufferSource();
        sourceNode.buffer = state.playback.buffer;
        sourceNode.playbackRate.value = Math.pow(
          2,
          state.playback.transpose / 12
        );
        if (state.playback.guideNotes && state.playback.guideNotes.length > 0) {
          renderPianoRollNotes(state.playback.guideNotes);
          if (state.ui.pianoRollVisible) {
            pianoRollContainer.classOn("visible");
          }
        }
        if (state.playback.isMultiplexed) {
          const vocalGuideAnalyser = audioContext.createAnalyser();
          vocalGuideAnalyser.fftSize = 2048;
          state.scoring.vocalGuideAnalyser = vocalGuideAnalyser;
          const delayNode = audioContext.createDelay();
          delayNode.delayTime.value = state.scoring.measuredLatencyS;
          state.scoring.guideVocalDelayNode = delayNode;
          const splitter = audioContext.createChannelSplitter(2);
          const leftGain = audioContext.createGain();
          const rightGain = audioContext.createGain();
          const monoMixer = audioContext.createGain();
          state.playback.leftPannerGain = leftGain;
          state.playback.rightPannerGain = rightGain;
          sourceNode.connect(splitter);
          splitter.connect(leftGain, 0);
          splitter.connect(rightGain, 1);
          splitter.connect(delayNode, 1);
          delayNode.connect(vocalGuideAnalyser);
          leftGain.connect(monoMixer);
          rightGain.connect(monoMixer);
          monoMixer.connect(masterGain);
          if (state.recording.trackDelayNode) {
            splitter.connect(state.recording.trackDelayNode, 0);
          }
          pkg.data.setMultiplexPan(state.playback.multiplexPan);
        } else {
          sourceNode.connect(masterGain);
          sourceNode.connect(state.scoring.musicAnalyser);
          if (pianoRollContainer) pianoRollContainer.classOff("visible");
          if (state.recording.trackDelayNode) {
            sourceNode.connect(state.recording.trackDelayNode);
          }
        }
        sourceNode.onended = () => {
          if (state.playback.status === "playing") pkg.data.stopTrack();
        };
        sourceNode.start(0, state.playback.pauseTime);
        state.playback.startTime = audioContext.currentTime;
        state.playback.status = "playing";
      }
      if (!state.playback.isMidi && !state.playback.isMultiplexed && state.playback.buffer) {
        if (typeof Meyda !== "undefined") {
          if (!state.scoring.meydaAnalyzer) {
            state.scoring.meydaAnalyzer = Meyda.createMeydaAnalyzer({
              audioContext,
              source: state.scoring.musicAnalyser,
              bufferSize: 2048,
              featureExtractors: ["chroma"]
            });
          }
          state.scoring.meydaAnalyzer.start();
        } else {
          console.warn(
            "[FORTE SVC] Meyda is not defined. Key-aware scoring will not function."
          );
        }
      }
      dispatchPlaybackUpdate();
      state.playback.lastFrameTime = performance.now();
      state.playback.smoothedTime = pkg.data.getPlaybackState().currentTime;
      if (animationFrameId === null) timingLoop();
    },
    /**
     * Briefly pauses track play preserving position counters and visual graphs.
     */
    pauseTrack: () => {
      if (state.playback.status !== "playing") return;
      state.scoring.enabled = false;
      if (pianoRollContainer) pianoRollContainer.classOff("visible");
      if (state.scoring.meydaAnalyzer) state.scoring.meydaAnalyzer.stop();
      if (state.recording.trackDelayNode) {
        state.recording.trackDelayNode.disconnect();
        if (state.playback.isMidi && state.playback.midiGain) {
          try {
            state.playback.midiGain.disconnect(state.recording.trackDelayNode);
          } catch (e) {
          }
        }
        state.recording.trackDelayNode = null;
      }
      if (state.playback.isMidi) {
        if (state.playback.sequencer) {
          try {
            state.playback.sequencer.pause();
          } catch (e) {
          }
        }
        state.playback.status = "paused";
      } else {
        if (!sourceNode) return;
        const rate = sourceNode.playbackRate.value;
        const elapsed = audioContext.currentTime - state.playback.startTime;
        state.playback.pauseTime += elapsed * rate;
        sourceNode.stop();
        state.playback.leftPannerGain = null;
        state.playback.rightPannerGain = null;
        state.playback.status = "paused";
        sourceNode = null;
      }
      logVerbose("Playback paused", pkg.data.getPlaybackState());
      dispatchPlaybackUpdate();
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    },
    /**
     * Ends track and resets active properties, wiping buffers and hiding tools.
     */
    stopTrack: () => {
      if (pianoRollContainer) pianoRollContainer.classOff("visible");
      if (state.playback.status === "stopped") return;
      state.playback.status = "stopped";
      if (state.scoring.meydaAnalyzer) state.scoring.meydaAnalyzer.stop();
      if (state.recording.trackDelayNode) {
        state.recording.trackDelayNode.disconnect();
        if (state.playback.isMidi && state.playback.midiGain) {
          try {
            state.playback.midiGain.disconnect(state.recording.trackDelayNode);
          } catch (e) {
          }
        }
        state.recording.trackDelayNode = null;
      }
      if (state.playback.isMidi) {
        if (state.playback.sequencer) {
          try {
            state.playback.sequencer.pause();
          } catch (e) {
          }
          try {
            state.playback.sequencer.currentTime = 0;
          } catch (e) {
          }
        }
      } else {
        if (sourceNode) {
          sourceNode.onended = null;
          sourceNode.stop();
          sourceNode = null;
        }
      }
      state.playback.leftPannerGain = null;
      state.playback.rightPannerGain = null;
      state.playback.multiplexPan = -1;
      state.playback.status = "stopped";
      state.playback.pauseTime = 0;
      logVerbose("Playback stopped", pkg.data.getPlaybackState());
      dispatchPlaybackUpdate();
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    },
    /**
     * Adjusts the overall music tracking output level via compressor thresholding.
     *
     * @param {number} level - Gain volume factor from 0.0 to 1.0.
     */
    setTrackVolume: (level) => {
      if (!masterGain) return;
      const clampedLevel = Math.max(0, Math.min(1, level));
      masterGain.gain.setValueAtTime(clampedLevel, audioContext.currentTime);
      state.playback.volume = clampedLevel;
      updateSfxGain();
      logVerbose("Track volume set", clampedLevel);
    },
    /**
     * Sets the sound effects volume independently from main track volume.
     * The actual SFX output is the product of main volume and SFX volume.
     *
     * @param {number} level - SFX volume factor from 0.0 to 1.0.
     */
    setSfxVolume: (level) => {
      const clampedLevel = Math.max(0, Math.min(1, level));
      state.playback.sfxVolume = clampedLevel;
      updateSfxGain();
      logVerbose("SFX volume set", clampedLevel);
    },
    /**
     * Enables or disables verbose engine logging.
     *
     * @param {boolean} enabled - Whether verbose logs should be active.
     */
    setVerbose: (enabled) => {
      state.verbose = Boolean(enabled);
      if (state.verbose) {
        logVerbose("Verbose logging enabled");
      } else {
        console.log("[FORTE SVC] Verbose logging disabled.");
      }
    },
    /**
     * Controls individual gain levels filtering split multiplex nodes pushing output toward specific sides.
     *
     * @param {number} panValue - Number mapped from -1 (Left/Inst) to 1 (Right/Vocal).
     */
    setMultiplexPan: (panValue) => {
      const pan = Math.max(-1, Math.min(1, panValue));
      state.playback.multiplexPan = pan;
      const { leftPannerGain, rightPannerGain } = state.playback;
      if (leftPannerGain && rightPannerGain) {
        leftPannerGain.gain.setValueAtTime(
          (1 - pan) / 2,
          audioContext.currentTime
        );
        rightPannerGain.gain.setValueAtTime(
          (1 + pan) / 2,
          audioContext.currentTime
        );
      }
      dispatchPlaybackUpdate();
    },
    /**
     * Alters structural playback properties scaling raw audio streams up and down or stepping SpessaSynth MIDI pitch.
     *
     * @param {number} semitones - Increment specifying half-step directionations.
     */
    setTranspose: (semitones) => {
      const clamped = Math.max(-24, Math.min(24, Math.round(semitones)));
      if (!state.playback.isMidi && state.playback.status === "playing" && sourceNode) {
        const rate = sourceNode.playbackRate.value;
        const elapsed = audioContext.currentTime - state.playback.startTime;
        state.playback.pauseTime += elapsed * rate;
        state.playback.startTime = audioContext.currentTime;
      }
      state.playback.transpose = clamped;
      if (state.playback.isMidi && state.playback.synthesizer) {
        state.playback.synthesizer.setMasterParameter("transposition", clamped);
      } else if (!state.playback.isMidi && sourceNode) {
        sourceNode.playbackRate.setValueAtTime(
          Math.pow(2, clamped / 12),
          audioContext.currentTime
        );
      }
      dispatchPlaybackUpdate();
    },
    /**
     * Gets the active scoring metrics.
     *
     * @returns {Object} Accuracy mapping metrics.
     */
    getScoringState: () => {
      return {
        finalScore: state.scoring.finalScore,
        details: state.scoring.details
      };
    },
    /**
     * Assembles all metadata properties currently framing active media tracks output.
     *
     * @returns {Object} Representation of engine time properties and statuses.
     */
    getPlaybackState: () => {
      let duration = 0;
      let currentTime = 0;
      if (state.playback.isMidi && state.playback.sequencer) {
        duration = state.playback.sequencer.duration || 0;
        currentTime = state.playback.sequencer.currentTime || 0;
      } else if (state.playback.buffer) {
        duration = state.playback.buffer.duration;
        if (state.playback.status === "playing" && sourceNode) {
          const rate = sourceNode.playbackRate.value;
          const elapsed = audioContext.currentTime - state.playback.startTime;
          currentTime = state.playback.pauseTime + elapsed * rate;
        } else {
          currentTime = state.playback.pauseTime;
        }
      }
      return {
        status: state.playback.status,
        currentTime: Math.min(currentTime, duration),
        duration,
        currentDeviceId: state.playback.currentDeviceId,
        isMidi: state.playback.isMidi,
        isMultiplexed: state.playback.isMultiplexed,
        hasGuideNotes: state.playback.guideNotes && state.playback.guideNotes.length > 0,
        decodedLyrics: state.playback.decodedLyrics,
        midiInfo: state.playback.midiInfo,
        transpose: state.playback.transpose,
        multiplexPan: state.playback.multiplexPan,
        score: pkg.data.getScoringState()
      };
    },
    /**
     * Warms up backend components initializing mic arrays logic scopes.
     */
    initializeScoringEngine: async () => {
      if (!audioContext) return;
      logVerbose("Initializing Scoring Engine...");
      await pkg.data.getMicDevices();
      await pkg.data.startMicInput(state.scoring.currentMicDeviceId);
    },
    /**
     * Operates automatic testing routines determining signal round trips between system nodes calibrating offsets.
     *
     * @returns {Promise<number>} Averaged latency delay in seconds.
     */
    runLatencyTest: async () => {
      if (!audioContext || !state.scoring.micAnalyser || !state.scoring.pitchDetector) {
        throw new Error("Audio context or mic not ready.");
      }
      logVerbose("Starting latency calibration...");
      const NTESTS = 8;
      const TEST_INTERVAL_S = 0.5;
      const TEST_TONE_DURATION_S = 0.1;
      const TEST_FREQ_HZ = 880;
      const TEST_PITCH_MIDI = 81;
      const WARMUP_S = 1;
      const TIMEOUT_S = WARMUP_S + NTESTS * TEST_INTERVAL_S + 2;
      const analyser = state.scoring.micAnalyser;
      const pitchDetector = state.scoring.pitchDetector;
      const buffer = new Float32Array(analyser.fftSize);
      let animationFrameId2;
      const testPromise = new Promise((resolve, reject) => {
        let latencies = [];
        let detectedBeeps = /* @__PURE__ */ new Set();
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.frequency.value = TEST_FREQ_HZ;
        gain.gain.value = 0;
        osc.connect(gain).connect(masterGain);
        osc.start();
        const baseTime = audioContext.currentTime + WARMUP_S;
        for (let i = 0; i < NTESTS; i++) {
          const t = baseTime + i * TEST_INTERVAL_S;
          gain.gain.setValueAtTime(1, t);
          gain.gain.setValueAtTime(0, t + TEST_TONE_DURATION_S);
        }
        const listenLoop = () => {
          if (audioContext.currentTime > baseTime + NTESTS * TEST_INTERVAL_S + 1)
            return;
          analyser.getFloatTimeDomainData(buffer);
          const [pitch, clarity] = pitchDetector.findPitch(
            buffer,
            audioContext.sampleRate
          );
          const detectedMidi = 12 * Math.log2(pitch / 440) + 69;
          if (clarity > 0.9 && Math.abs(detectedMidi - TEST_PITCH_MIDI) < 1) {
            const inputTime = audioContext.currentTime;
            const timeSinceBase = inputTime - baseTime;
            const idx = Math.floor(timeSinceBase / TEST_INTERVAL_S);
            if (idx >= 0 && idx < NTESTS && !detectedBeeps.has(idx)) {
              const scheduledTime = baseTime + idx * TEST_INTERVAL_S;
              const latency = inputTime - scheduledTime;
              if (latency > 0.01 && latency < 0.5) {
                latencies.push(latency);
                detectedBeeps.add(idx);
              }
            }
          }
          animationFrameId2 = requestAnimationFrame(listenLoop);
        };
        animationFrameId2 = requestAnimationFrame(listenLoop);
        setTimeout(() => {
          cancelAnimationFrame(animationFrameId2);
          osc.stop();
          gain.disconnect();
          osc.disconnect();
          if (latencies.length < NTESTS / 2) {
            reject(new Error("Calibration failed: Signal too weak."));
            return;
          }
          const mean = latencies.reduce((a, b) => a + b) / latencies.length;
          const std = Math.sqrt(
            latencies.map((x) => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / latencies.length
          );
          if (std > 0.05) {
            reject(new Error("Calibration failed: High variance."));
            return;
          }
          state.scoring.measuredLatencyS = mean;
          resolve(mean);
        }, TIMEOUT_S * 1e3);
      });
      return await testPromise;
    },
    /**
     * Force overwrites the mic delay.
     *
     * @param {number} latencySeconds - Decimal value fixing input buffers.
     */
    setLatency: (latencySeconds) => {
      if (typeof latencySeconds !== "number" || isNaN(latencySeconds)) return;
      state.scoring.measuredLatencyS = Math.max(0, Math.min(1, latencySeconds));
    },
    /**
     * Enumerates local peripheral input targets listing hardware.
     *
     * @returns {Promise<Array<{label: string, deviceId: string}>>} List representing mic devices.
     */
    getMicDevices: async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        state.scoring.micDevices = devices.filter((d) => d.kind === "audioinput").map((d) => ({ label: d.label, deviceId: d.deviceId }));
        return state.scoring.micDevices;
      } catch (e) {
        return [];
      }
    },
    /**
     * Shifts engine input recording mapping to the chosen microphone device hardware.
     *
     * @param {string} deviceId - Local device token.
     */
    setMicDevice: async (deviceId) => {
      await pkg.data.startMicInput(deviceId);
      state.scoring.currentMicDeviceId = deviceId;
    },
    /**
     * Switches capturing capability enabling system parsing.
     *
     * @param {boolean} enabled - Flag mapping function.
     */
    setMicInputEnabled: async (enabled) => {
      state.scoring.userInputEnabled = enabled;
      if (enabled) {
        await pkg.data.startMicInput(state.scoring.currentMicDeviceId);
      } else {
        pkg.data.stopMicInput();
      }
    },
    /**
     * Disconnects nodes cutting streams directly from microphones terminating buffers.
     */
    stopMicInput: () => {
      logVerbose("Stopping microphone input");
      if (state.scoring.micStream) {
        state.scoring.micStream.getTracks().forEach((track) => track.stop());
        state.scoring.micStream = null;
      }
      if (state.scoring.micSourceNode) {
        try {
          state.scoring.micSourceNode.disconnect();
        } catch (e) {
        }
        state.scoring.micSourceNode = null;
      }
      if (state.scoring.micHighpassNode) {
        try {
          state.scoring.micHighpassNode.disconnect();
        } catch (e) {
        }
        state.scoring.micHighpassNode = null;
      }
      if (state.scoring.micLowpassNode) {
        try {
          state.scoring.micLowpassNode.disconnect();
        } catch (e) {
        }
        state.scoring.micLowpassNode = null;
      }
      if (state.scoring.micAnalyser) {
        try {
          state.scoring.micLowpassNode.disconnect(state.scoring.micAnalyser);
        } catch (e) {
        }
        state.scoring.micAnalyser = null;
      }
      state.scoring.enabled = false;
      console.log(
        "[FORTE SVC] Microphone input stopped (Performance/User req)."
      );
    },
    /**
     * Resolves promises establishing physical microphone feeds creating analyzer pipelines.
     *
     * @param {string} [deviceId="default"] - Selection criteria.
     */
    startMicInput: async (deviceId = "default") => {
      pkg.data.stopMicInput();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: deviceId },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        });
        state.scoring.micStream = stream;
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(state.effects.micChainInput);
        const hpFilter = audioContext.createBiquadFilter();
        hpFilter.type = "highpass";
        hpFilter.frequency.value = 85;
        const lpFilter = audioContext.createBiquadFilter();
        lpFilter.type = "lowpass";
        lpFilter.frequency.value = 2e3;
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(hpFilter);
        hpFilter.connect(lpFilter);
        lpFilter.connect(analyser);
        state.scoring.micSourceNode = source;
        state.scoring.micHighpassNode = hpFilter;
        state.scoring.micLowpassNode = lpFilter;
        state.scoring.micAnalyser = analyser;
        if (!state.scoring.pitchDetector) {
          state.scoring.pitchDetector = PitchDetector.forFloat32Array(
            analyser.fftSize
          );
        }
        state.scoring.enabled = true;
        logVerbose("Microphone input started with isolated scoring filters", {
          deviceId
        });
      } catch (e) {
        console.error("[FORTE SVC] Failed to get microphone input:", e);
      }
    },
    /**
     * Assembles audio worklets applying effects dynamically generating chains.
     *
     * @param {Array<Object>} chainConfig - Mapped representations configuring instances.
     */
    loadVocalChain: async (chainConfig) => {
      state.effects.vocalChainConfig = JSON.parse(JSON.stringify(chainConfig));
      state.effects.vocalChain.forEach((plugin) => plugin.disconnect());
      state.effects.vocalChain = [];
      for (let i = 0; i < chainConfig.length; i++) {
        const pluginConfig = chainConfig[i];
        try {
          logVerbose("Loading plugin configuration", pluginConfig);
          const pluginModule = await import(pluginConfig.path);
          const PluginClass = pluginModule.default;
          let pluginInstance;
          if (typeof PluginClass.create === "function") {
            pluginInstance = await PluginClass.create(audioContext);
          } else {
            pluginInstance = new PluginClass(audioContext);
          }
          if (pluginConfig.params) {
            for (const [key, value] of Object.entries(pluginConfig.params)) {
              pluginInstance.setParameter(key, value);
            }
          }
          const originalSetParameter = pluginInstance.setParameter;
          if (typeof originalSetParameter === "function") {
            pluginInstance.setParameter = function(paramName, value) {
              originalSetParameter.call(this, paramName, value);
              if (state.effects.vocalChainConfig[i]) {
                if (!state.effects.vocalChainConfig[i].params) {
                  state.effects.vocalChainConfig[i].params = {};
                }
                state.effects.vocalChainConfig[i].params[paramName] = value;
                if (saveVocalChainTimeout) clearTimeout(saveVocalChainTimeout);
                saveVocalChainTimeout = setTimeout(() => {
                  if (window.config && typeof window.config.setItem === "function") {
                    window.config.setItem(
                      "audioConfig.vocalChain",
                      state.effects.vocalChainConfig
                    );
                    logVerbose("Saved updated vocal chain config to disk.");
                  }
                }, 300);
              }
            };
          }
          state.effects.vocalChain.push(pluginInstance);
        } catch (e) {
          console.error(`[FORTE SVC] Failed to load plugin.`, e);
        }
      }
      pkg.data.rebuildVocalChain();
    },
    /**
     * Bridges disparate nodes constructing one coherent graph modifying stream components.
     */
    rebuildVocalChain: () => {
      logVerbose("Rebuilding vocal chain", {
        chainLength: state.effects.vocalChain.length
      });
      const { micChainInput, micChainOutput, vocalChain } = state.effects;
      micChainInput.disconnect();
      let lastNode = micChainInput;
      if (vocalChain.length > 0) {
        vocalChain.forEach((plugin) => {
          lastNode.connect(plugin.input);
          lastNode = plugin.output;
        });
      }
      lastNode.connect(micChainOutput);
    },
    /**
     * Shifts state modifying loaded node specific internal parameter objects.
     *
     * @param {number} pluginIndex - Array location index.
     * @param {string} paramName - Field property designation string.
     * @param {number} value - Floating target logic adjusting module specific traits.
     */
    setPluginParameter: (pluginIndex, paramName, value) => {
      const plugin = state.effects.vocalChain[pluginIndex];
      if (plugin) plugin.setParameter(paramName, value);
    },
    /**
     * Target shifting level affecting final recorded volume outputs of microphones.
     *
     * @param {number} level - Target mapping gain values from 0 to 2.
     */
    setMicRecordingVolume: (level) => {
      const clamped = Math.max(0, Math.min(2, level));
      state.effects.micGainInRecording = clamped;
      if (state.effects.micChainOutput) {
        state.effects.micChainOutput.gain.setTargetAtTime(
          clamped,
          audioContext.currentTime,
          0.01
        );
      }
      if (saveVolumesTimeout) clearTimeout(saveVolumesTimeout);
      saveVolumesTimeout = setTimeout(() => {
        if (window.config && typeof window.config.setItem === "function") {
          window.config.setItem("audioConfig.micRecordingVolume", clamped);
          logVerbose("Saved mic recording volume to disk.");
        }
      }, 300);
    },
    /**
     * Target shifting level affecting final recorded volume outputs of background tracks.
     *
     * @param {number} level - Target mapping gain values from 0 to 1.
     */
    setMusicRecordingVolume: (level) => {
      const clamped = Math.max(0, Math.min(1, level));
      state.effects.musicGainInRecording = clamped;
      if (state.recording.musicRecordingGainNode) {
        state.recording.musicRecordingGainNode.gain.setTargetAtTime(
          clamped,
          audioContext.currentTime,
          0.01
        );
      }
      if (saveVolumesTimeout) clearTimeout(saveVolumesTimeout);
      saveVolumesTimeout = setTimeout(() => {
        if (window.config && typeof window.config.setItem === "function") {
          window.config.setItem("audioConfig.musicRecordingVolume", clamped);
          logVerbose("Saved music recording volume to disk.");
        }
      }, 300);
    },
    /**
     * Compiles properties describing effect logic status across chains currently operating.
     *
     * @returns {Object} Data schema reflecting internal values across loaded objects.
     */
    getVocalChainState: () => {
      const chainState = state.effects.vocalChain.map((plugin, i) => ({
        name: plugin.name,
        path: state.effects.vocalChainConfig[i]?.path,
        parameters: plugin.parameters,
        instance: plugin
      }));
      return {
        micGain: state.effects.micGainInRecording,
        musicGain: state.effects.musicGainInRecording,
        chain: chainState,
        rawConfig: state.effects.vocalChainConfig || []
      };
    }
  },
  /**
   * Disconnects nodes ensuring all resources map closed exiting contexts appropriately.
   */
  end: async function() {
    console.log("[FORTE SVC] Shutting down.");
    if (pianoRollContainer) pianoRollContainer.cleanup();
    if (state.scoring.micStream) {
      state.scoring.micStream.getTracks().forEach((track) => track.stop());
    }
    if (audioContext && audioContext.state !== "closed") {
      if (state.effects.micChainInput) state.effects.micChainInput.disconnect();
      if (state.effects.micChainOutput)
        state.effects.micChainOutput.disconnect();
      state.effects.vocalChain.forEach((p) => p.disconnect());
      if (masterCompressor) masterCompressor.disconnect();
      if (state.recording.destinationNode)
        state.recording.destinationNode.disconnect();
      audioContext.close();
    }
    sfxCache.clear();
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    if (state.playback.synthesizer) {
      state.playback.synthesizer.disconnect();
      state.playback.synthesizer = null;
    }
  }
};
var Forte_default = pkg;
export {
  Forte_default as default
};
//# sourceMappingURL=Forte.js.map
