'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.verify = exports.signAsync = exports.sign = exports.magicHash = void 0;
const bs58check = require('bs58check');
const bech32_1 = require('bech32');
const secp256k1 = require('tiny-secp256k1');
const varuint = require('varuint-bitcoin');
const crypto_1 = require('./crypto');
const SEGWIT_TYPES = {
  P2WPKH: 'p2wpkh',
  P2SH_P2WPKH: 'p2sh(p2wpkh)',
};
function encodeSignature(signature, recovery, compressed, segwitType) {
  if (segwitType !== undefined) {
    recovery += 8;
    if (segwitType === SEGWIT_TYPES.P2WPKH) recovery += 4;
  } else {
    if (compressed) recovery += 4;
  }
  return Buffer.concat([Buffer.alloc(1, recovery + 27), signature]);
}
function decodeSignature(buffer) {
  if (buffer.length !== 65) throw new Error('Invalid signature length');
  const flagByte = buffer.readUInt8(0) - 27;
  if (flagByte > 15 || flagByte < 0) {
    throw new Error('Invalid signature parameter');
  }
  return {
    compressed: !!(flagByte & 12),
    segwitType: !(flagByte & 8)
      ? null
      : !(flagByte & 4)
      ? SEGWIT_TYPES.P2SH_P2WPKH
      : SEGWIT_TYPES.P2WPKH,
    recovery: flagByte & 3,
    signature: buffer.slice(1),
  };
}
function magicHash(message, messagePrefix) {
  messagePrefix = messagePrefix || '\u0018Bitcoin Signed Message:\n';
  if (!Buffer.isBuffer(messagePrefix)) {
    messagePrefix = Buffer.from(messagePrefix, 'utf8');
  }
  if (!Buffer.isBuffer(message)) {
    message = Buffer.from(message, 'utf8');
  }
  const messageVISize = varuint.encodingLength(message.length);
  const buffer = Buffer.allocUnsafe(
    messagePrefix.length + messageVISize + message.length,
  );
  messagePrefix.copy(buffer, 0);
  varuint.encode(message.length, buffer, messagePrefix.length);
  message.copy(buffer, messagePrefix.length + messageVISize);
  return (0, crypto_1.hash256)(buffer);
}
exports.magicHash = magicHash;
function prepareSign(messagePrefixArg, sigOptions) {
  if (typeof messagePrefixArg === 'object' && sigOptions === undefined) {
    // @ts-ignore
    sigOptions = messagePrefixArg;
    messagePrefixArg = undefined;
  }
  let segwitType = (sigOptions || {}).segwitType;
  const extraEntropy = sigOptions && sigOptions.extraEntropy;
  if (
    segwitType &&
    (typeof segwitType === 'string' || segwitType instanceof String)
  ) {
    segwitType = segwitType.toLowerCase();
  }
  if (
    segwitType &&
    segwitType !== SEGWIT_TYPES.P2SH_P2WPKH &&
    segwitType !== SEGWIT_TYPES.P2WPKH
  ) {
    throw new Error(
      'Unrecognized segwitType: use "' +
        SEGWIT_TYPES.P2SH_P2WPKH +
        '" or "' +
        SEGWIT_TYPES.P2WPKH +
        '"',
    );
  }
  return {
    // @ts-ignore
    messagePrefixArg,
    segwitType,
    extraEntropy,
  };
}
function isSigner(obj) {
  return obj && typeof obj.sign === 'function';
}
function sign(message, privateKey, compressed, messagePrefix, sigOptions) {
  const { messagePrefixArg, segwitType, extraEntropy } = prepareSign(
    messagePrefix,
    sigOptions,
  );
  const hash = magicHash(message, messagePrefixArg);
  const sigObj = isSigner(privateKey)
    ? privateKey.sign(hash, extraEntropy)
    : secp256k1.signRecoverable(hash, privateKey, extraEntropy);
  return encodeSignature(
    Buffer.from(sigObj.signature),
    sigObj.recoveryId,
    compressed,
    segwitType,
  );
}
exports.sign = sign;
function signAsync(message, privateKey, compressed, messagePrefix, sigOptions) {
  let messagePrefixArg;
  let extraEntropy;
  let segwitType;
  return Promise.resolve()
    .then(() => {
      ({ messagePrefixArg, segwitType, extraEntropy } = prepareSign(
        messagePrefix,
        sigOptions,
      ));
      const hash = magicHash(message, messagePrefixArg);
      return isSigner(privateKey)
        ? privateKey.sign(hash, extraEntropy)
        : secp256k1.signRecoverable(hash, privateKey, extraEntropy);
    })
    .then((sigObj) => {
      return encodeSignature(
        Buffer.from(sigObj.signature),
        sigObj.recoveryId,
        compressed,
        segwitType,
      );
    });
}
exports.signAsync = signAsync;
function segwitRedeemHash(publicKeyHash) {
  const redeemScript = Buffer.concat([
    Buffer.from('0014', 'hex'),
    publicKeyHash,
  ]);
  return (0, crypto_1.hash160)(redeemScript);
}
function decodeBech32(address) {
  const result = bech32_1.bech32.decode(address);
  const data = bech32_1.bech32.fromWords(result.words.slice(1));
  return Buffer.from(data);
}
function verify(message, address, signature, messagePrefix, checkSegwitAlways) {
  if (!Buffer.isBuffer(signature)) signature = Buffer.from(signature, 'base64');
  const parsed = decodeSignature(signature);
  if (checkSegwitAlways && !parsed.compressed) {
    throw new Error(
      'checkSegwitAlways can only be used with a compressed pubkey signature flagbyte',
    );
  }
  const hash = magicHash(message, messagePrefix);
  const publicKey = secp256k1.recover(
    hash,
    parsed.signature,
    parsed.recovery,
    parsed.compressed,
  );
  if (!publicKey) throw new Error('Public key is point at infinity!');
  const publicKeyHash = (0, crypto_1.hash160)(Buffer.from(publicKey));
  let actual;
  let expected;
  if (parsed.segwitType) {
    if (parsed.segwitType === SEGWIT_TYPES.P2SH_P2WPKH) {
      actual = segwitRedeemHash(publicKeyHash);
      expected = bs58check.decode(address).slice(1);
    } else {
      // parsed.segwitType === SEGWIT_TYPES.P2WPKH
      // must be true since we only return null, P2SH_P2WPKH, or P2WPKH
      // from the decodeSignature function.
      actual = publicKeyHash;
      expected = decodeBech32(address);
    }
  } else {
    if (checkSegwitAlways) {
      try {
        expected = decodeBech32(address);
        // if address is bech32 it is not p2sh
        return publicKeyHash.equals(expected);
      } catch (e) {
        const redeemHash = segwitRedeemHash(publicKeyHash);
        expected = bs58check.decode(address).slice(1);
        // base58 can be p2pkh or p2sh-p2wpkh
        return publicKeyHash.equals(expected) || redeemHash.equals(expected);
      }
    } else {
      actual = publicKeyHash;
      expected = bs58check.decode(address).slice(1);
    }
  }
  return actual.equals(expected);
}
exports.verify = verify;
