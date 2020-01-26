class Encoder {
    constructor(options) {
        options = options || {};
        this._textEncoder = new TextEncoder();
        this._staticDictionary = options.staticDictionary || [];
        this._dynamicDictionary = [];
        this._dynamicPositions = {};
        this._dynamicInserted = 0;
        this._bytes = new Uint8Array(new ArrayBuffer(64 * 1024 * 1024));
        this._dataView = new DataView(this._bytes.buffer);
        this._offset = 0;
        if(this._staticDictionary.length > 2048) {
            throw 'Static dictionary exceeds maximum length (2048)';
        }
        this._staticPositions = {};
        for(var i = 0; i < this._staticDictionary.length; i++) {
            this._staticPositions[this._staticDictionary[i]] = i;
        }
    }

    encodeValue(value) {
        this._dataView.setUint8(0, 211);
        this._dataView.setUint8(1, 'J'.charCodeAt(0));
        this._dataView.setUint8(2, 'R'.charCodeAt(0));
        this._dataView.setUint8(3, 'b'.charCodeAt(0));
        this._dataView.setUint8(4, 1);
        this._dataView.setUint8(5, 0);
        this._dataView.setUint16(6, this._staticDictionary.length);
        this._offset += 8;
        this._encodeValue(value);
        return new DataView(this._dataView.buffer, 0, this._offset);
    }

    _encodeValue(value) {
        switch(typeof value) {
            case 'number': this._encodeNumber(value); break;
            case 'string': this._encodeString(value); break;
            case 'boolean': this._encodeBoolean(value); break;
            default:
                if(value === null) this._encodeNull(value); 
                else if(Array.isArray(value)) this._encodeArray(value);
                else this._encodeObject(value);
        }
    }

    _encodeString(value) {
        // Check for empty string and dictionaries
        if(value.length === 0) {
            this._writeKindAndLength(2, 0);
            return;
        }
        if(Object.prototype.hasOwnProperty.call(this._dynamicPositions, value)) {
            this._extendBuffer(1);
            this._dataView.setUint8(this._offset, this._dynamicPositions[value]);
            this._offset += 1;
            return;
        }
        if(Object.prototype.hasOwnProperty.call(this._staticPositions, value)) {
            this._extendBuffer(2);
            let v = 0b1100_0000_0000_0000 | this._staticPositions[value];
            this._dataView.setUint16(this._offset, v);
            this._offset += 2;
            return;
        }
        // TODO: Check for "data:" prefix and attempt binary encoding
        // Encode plain UTF-8 string
        let utf8 = this._textEncoder.encode(value);
        this._writeKindAndLength(2, utf8.length);
        this._extendBuffer(this._offset + utf8.length);
        this._bytes.set(utf8, this._offset);
        this._offset += utf8.length;
        let i = this._dynamicInserted & 0b0111_1111;
        // Update dynamic dictionary
        if(utf8.length > 128) return;
        this._dynamicDictionary[i] = value;
        this._dynamicPositions[value] = i;
        this._dynamicInserted += 1;
        let j = this._dynamicInserted & 0b0111_1111;
        let k = this._dynamicDictionary[j];
        if(this._dynamicPositions[k] === j) {
            delete this._dynamicPositions[k];
        }
    }

    _encodeObject(value) {
        let keys = Object.keys(value);
        this._writeKindAndLength(1, keys.length);
        for(let i = 0; i < keys.length; i++) {
            let k = keys[i];
            this._encodeValue(k); // TODO: Static dictionary key order
            this._encodeValue(value[k]);
        }
    }

    _encodeArray(value) {
        this._writeKindAndLength(0, value.length);
        for(let i = 0; i < value.length; i++) {
            this._encodeValue(value[i]);
        }
    }

    _encodeBoolean(value) {
        this._extendBuffer(this._offset + 1);
        this._dataView.setUint8(this._offset, value ? 0b1111_1110 : 0b1111_1101);
        this._offset += 1;
    }

    _encodeNull(value) {
        this._extendBuffer(this._offset + 1);
        this._dataView.setUint8(this._offset, 0b1111_1100);
        this._offset += 1;
    }

    _encodeNumber(value) {
        if(value === value & 0b01_1111) {
            this._extendBuffer(this._offset + 1);
            // TODO: More cases for optimized number encoding.
            this._dataView.setUint8(this._offset, 0b1000_0000 | (value + 16));
            this._offset += 1;
        } else {
            this._extendBuffer(this._offset + 9);
            this._dataView.setUint8(this._offset, 0b1111_1010);
            this._offset += 1;
            this._dataView.setFloat64(this._offset, value);
            this._offset += 8;
        }
    }

    _writeKindAndLength(kind, length) {
        if(length <= 0b111) {
            this._extendBuffer(this._offset + 1);
            this._dataView.setUint8(this._offset, 0b1101_0000 + (kind << 3) + length);
            this._offset += 1;
        } else if(length <= 0xff_ff) {
            this._extendBuffer(this._offset + 3);
            this._dataView.setUint8(this._offset, 0b1111_0000 + kind);
            this._offset += 1;
            this._dataView.setUint16(this._offset, length);
            this._offset += 2;
        } else if(length <= 0xff_ff_ff_ff_ff_ff) {
            this._extendBuffer(this._offset + 7);
            this._dataView.setUint8(this._offset, 0b1111_0100 + kind);
            this._offset += 1;
            this._dataView.setUint16(this._offset, length >>> 32);
            this._offset += 2;
            this._dataView.setUint32(this._offset, length & 0xff_ff_ff_ff);
            this._offset += 4;
        } else {
            throw 'Length exceeds what can be stored in a 48 bit value: ' + length;
        }
    }

    _extendBuffer(capacity) {
        if(capacity <= this._bytes.length) return;
        let oldBytes = this._bytes;
        if(ArrayBuffer.transfer) {
            this._bytes = new Uint8Array(ArrayBuffer.transfer(oldBytes.buffer, 2 * oldBytes.length));
        } else {
            this._bytes = new Uint8Array(new ArrayBuffer(2 * oldBytes.length));
            this._bytes.set(oldBytes);
        }
        this._dataView = new DataView(this._bytes.buffer);
    }

}

Encoder.encode = function(value, options) {
    return new Encoder(options).encodeValue(value);    
};




class Decoder {

    constructor(dataView, options) {
        options = options || {};
        this._dataView = dataView;
        this._offset = 0;
        this._staticDictionary = options.staticDictionary || [];
        this._textDecoder = new TextDecoder('utf-8');

        if(
            this._byte(0) !== 211 ||
            this._byte(1) !== 'J'.charCodeAt(0) ||
            this._byte(2) !== 'R'.charCodeAt(0) ||
            this._byte(3) !== 'b'.charCodeAt(0)
        ) {
            throw new DecoderError(this._offset, "Expected binary format header \\211 J R b");
        }
        this._offset += 4;

        if(this._byte(0) !== 1) {
            throw new DecoderError(this._offset,
                "Expected binary format version 1, but encountered " + this._byte(0));
        }
        this._offset += 1;
        
        if(this._byte(0) !== 0) {
            throw new DecoderError(this._offset,
                "Expected all-zero reserved byte, but encountered " + this._byte(0));
        }
        this._offset += 1;
        
        let staticDictionarySize = this._dataView.getUint16(this._offset);
        if(staticDictionarySize > 2048) {
            throw new DecoderError(offset,
                "Expected a maximum of 2048 dictionary entries, but encountered " +
                staticDictionarySize);
        }
        if(staticDictionarySize > this._staticDictionary.length) {
            throw new DecoderError(this._offset,
                "The file requires " + staticDictionarySize + " static dictionary " +
                "entries, but only " + this._staticDictionary.length + " were supplied");
        }
        this._staticDictionary = this._staticDictionary.slice(0, staticDictionarySize);
        this._offset += 2;

        this._dynamicDictionary = new Array(128).fill("");
        this._dynamicDictionaryOffset = 0;
    }

    decodeValue() {
        let b = this._byte(0);
        let i = 0, j = 0, k = 0;
        this._offset += 1;
        if(b <= 0b0111_1111) { // Dynamic dictionary entry x
            return this._dynamicDictionary[b];
        } else if(b <= 0b1011_1111) { // Integer x-16
            return b - 0b1000_0000 - 16;
        } else if(b <= 0b1110_1111) {
            i = b & 0b111;
            switch(b >>> 3) {
                case 0b1100_0: // Static dictionary entry x
                    j = (i << 8) | this._byte(0);
                    this._offset += 1;
                    return this._staticDictionary[j] || "";
                case 0b1100_1: // An 11 bit integer x+1008
                    j = (i << 8) | this._byte(0);
                    this._offset += 1;
                    return j + 1008;
                case 0b1101_0: // Array of size x
                    return this._decodeArray(i);
                case 0b1101_1: // Object of size x
                    return this._decodeObject(i);
                case 0b1110_0: // String of size x
                    return this._decodeString(i);
                case 0b1110_1: // Data of size x
                    return this._decodeData(i);
            }
        } else if(b <= 0b1111_0011) {
            i = this._dataView.getUint16(this._offset);
            this._offset += 2;
            switch(b) {
                case 0b1111_0000: // Array of size x
                    return this._decodeArray(i);
                case 0b1111_0001: // Object of size x
                    return this._decodeObject(i);
                case 0b1111_0010: // String of size x
                    return this._decodeString(i);
                case 0b1111_0011: // Data of size x
                    return this._decodeData(i);
            }
        } else if(b <= 0b1111_0111) {
            i = this._dataView.getUint16(this._offset);
            this._offset += 2;
            j = this._dataView.getUint32(this._offset);
            this._offset += 4;
            k = (i << 32) | j;
            switch(b) {
                case 0b1111_0100: // Array of size x
                    return this._decodeArray(k);
                case 0b1111_0101: // Object of size x
                    return this._decodeObject(k);
                case 0b1111_0110: // String of size x
                    return this._decodeString(k);
                case 0b1111_0111: // Data of size x
                    return this._decodeData(k);
            }
        } else {
            switch(b) {
                case 0b1111_1000: // A 32 bit signed integer x
                    i = this._dataView.getInt32(this._offset);
                    this._offset += 4;
                    return i;
                case 0b1111_1001: // A 32 bit floating point number x
                    i = this._dataView.getFloat32(this._offset);
                    this._offset += 4;
                    return i;
                case 0b1111_1010: // A 64 bit floating point number x
                    i = this._dataView.getFloat64(this._offset);
                    this._offset += 8;
                    return i;
                case 0b1111_1011: // (reserved)
                    throw new DecoderError(this._offset - 1,
                        "Reserved byte encountered: 1111 1011");
                case 0b1111_1100: // null
                    return null;
                case 0b1111_1101: // false
                    return false;
                case 0b1111_1110: // true
                    return true;
                case 0b1111_1111: // (reserved)
                    throw new DecoderError(this._offset - 1,
                        "Reserved byte encountered: 1111 1111");
            }
            throw new DecoderError(this._offset - 1,
                "Internal error: unhandled byte " + b);
        }
    }

    _byte(extraOffset) {
        return this._dataView.getUint8(this._offset + extraOffset);
    }

    _decodeArray(length) {
        let result = new Array(length);
        for(let i = 0; i < length; i++) {
            result[i] = this.decodeValue();
        }
        return result;
    }

    _decodeObject(length) {
        let result = {};
        for(let i = 0; i < length; i++) {
            let o = this._offset;
            let f = this.decodeValue();
            if(typeof f !== 'string') {
                throw new DecoderError(o, "Expected a field name");
            }
            result[f] = this.decodeValue();
        }
        return result;
    }

    _decodeString(length) {
        let v = this._textDecoder.decode(new DataView(this._dataView.buffer, this._offset, length));
        this._offset += length;
        if(v.length > 0 && v.length <= 128) {
            this._dynamicDictionary[this._dynamicDictionaryOffset] = v;
            this._dynamicDictionaryOffset = (this._dynamicDictionaryOffset + 1) & 0b0111_1111;
        }
        return v;
    }

    _decodeData(length) {
        let o = this._offset;
        let m = this.decodeValue();
        if(typeof m !== 'string') {
            throw new DecoderError(o, "Expected a mediatype string");
        }
        let v = new DataView(this._dataView.buffer, this._offset, length);
        this._offset += length;
        return "data:" + m + "," + btoa(v);
    }

}

Decoder.decode = function(dataView, options) {
    return new Decoder(dataView, options).decodeValue();
};

class DecoderError extends Error {
    constructor(offset, message) {
        super(message + " at offset " + offset);
        this.offset = offset;
    }
}
