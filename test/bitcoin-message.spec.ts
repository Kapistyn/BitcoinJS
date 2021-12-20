import * as assert from 'assert';
import { describe, it } from 'mocha';

import ECPairFactory from 'ecpair';
import * as bs58check from 'bs58check';
import { bech32 } from 'bech32';
// import * as createHash from 'create-hash';
const bitcoin = require('bitcoinjs-lib');
const BigInteger = require('bigi');
const secp256k1 = require('secp256k1');
const tinySecp256k1 = require('tiny-secp256k1');

const ECPair = ECPairFactory(tinySecp256k1);

import { hash160 } from '../src/crypto';

// const message = require('../src/index');
import * as message from '../src';

// const fixtures = require('./fixtures.json');
import * as fixtures from './fixtures.json';

function getMessagePrefix(networkName: string): string {
  //@ts-ignore
  return fixtures.networks[networkName];
}

describe('magicHash', () => {
  fixtures.valid.magicHash.forEach((f) => {
    it(
      'produces the magicHash for "' + f.message + '" (' + f.network + ')',
      () => {
        const actual = message.magicHash(
          f.message,
          getMessagePrefix(f.network),
        );
        assert.strictEqual(actual.toString('hex'), f.magicHash);
      },
    );
  });
});

describe('sign', () => {
  fixtures.valid.sign.forEach((f) => {
    it(f.description, async () => {
      const pk = ECPair.fromPrivateKey(
        new BigInteger(f.d).toBuffer(32),
      ).privateKey;
      const signer = (hash: Buffer, ex: Buffer) =>
        secp256k1.sign(hash, pk, { data: ex });
      const signerAsync = async (hash: Buffer, ex: Buffer) =>
        secp256k1.sign(hash, pk, { data: ex });
      let signature = message.sign(
        f.message,
        pk,
        false,
        getMessagePrefix(f.network),
      );
      let signature2 = message.sign(
        f.message,
        { sign: signer },
        false,
        getMessagePrefix(f.network),
      );
      let signature3 = await message.signAsync(
        f.message,
        { sign: signerAsync },
        false,
        getMessagePrefix(f.network),
      );
      let signature4 = await message.signAsync(
        f.message,
        { sign: signer },
        false,
        getMessagePrefix(f.network),
      );
      let signature5 = await message.signAsync(
        f.message,
        pk,
        false,
        getMessagePrefix(f.network),
      );
      assert.strictEqual(signature.toString('base64'), f.signature);
      assert.strictEqual(signature2.toString('base64'), f.signature);
      assert.strictEqual(signature3.toString('base64'), f.signature);
      assert.strictEqual(signature4.toString('base64'), f.signature);
      assert.strictEqual(signature5.toString('base64'), f.signature);

      if (f.compressed) {
        signature = message.sign(
          f.message,
          pk,
          true,
          getMessagePrefix(f.network),
        );
        assert.strictEqual(
          signature.toString('base64'),
          f.compressed.signature,
        );
      }

      if (f.segwit) {
        if (f.segwit.P2SH_P2WPKH) {
          signature = message.sign(
            f.message,
            pk,
            true,
            getMessagePrefix(f.network),
            { segwitType: 'p2sh(p2wpkh)' },
          );
          assert.strictEqual(
            signature.toString('base64'),
            f.segwit.P2SH_P2WPKH.signature,
          );
        }
        if (f.segwit.P2WPKH) {
          signature = message.sign(
            f.message,
            pk,
            true,
            getMessagePrefix(f.network),
            { segwitType: 'p2wpkh' },
          );
          assert.strictEqual(
            signature.toString('base64'),
            f.segwit.P2WPKH.signature,
          );
        }
      }
    });
  });
});
describe('verify', () => {
  fixtures.valid.verify.forEach((f) => {
    it('a valid signature for "' + f.message + '" (' + f.network + ')', () => {
      assert.strictEqual(
        message.verify(
          f.message,
          f.address,
          f.signature,
          getMessagePrefix(f.network),
        ),
        true,
      );

      if (f.network === 'bitcoin') {
        // defaults to bitcoin network
        assert.strictEqual(
          message.verify(f.message, f.address, f.signature),
          true,
        );
      }

      if (f.compressed) {
        assert.strictEqual(
          message.verify(
            f.message,
            f.compressed.address,
            f.compressed.signature,
            getMessagePrefix(f.network),
          ),
          true,
        );
      }

      if (f.segwit) {
        if (f.segwit.P2SH_P2WPKH) {
          assert.strictEqual(
            message.verify(
              f.message,
              f.segwit.P2SH_P2WPKH.address,
              f.segwit.P2SH_P2WPKH.signature,
              getMessagePrefix(f.network),
            ),
            true,
          );
          assert.strictEqual(
            message.verify(
              f.message,
              f.segwit.P2SH_P2WPKH.address,
              f.segwit.P2SH_P2WPKH.signature.replace(/^./, 'I'),
              getMessagePrefix(f.network),
              true,
            ),
            true,
          );
        }
        if (f.segwit.P2WPKH) {
          assert.strictEqual(
            message.verify(
              f.message,
              f.segwit.P2WPKH.address,
              f.segwit.P2WPKH.signature,
              getMessagePrefix(f.network),
            ),
            true,
          );
          assert.strictEqual(
            message.verify(
              f.message,
              f.segwit.P2WPKH.address,
              f.segwit.P2WPKH.signature.replace(/^./, 'I'),
              getMessagePrefix(f.network),
              true,
            ),
            true,
          );
        }
      }
    });
  });
});
describe('decode signature', () => {
  fixtures.invalid.signature.forEach((f) => {
    it('throws on ' + f.hex, () => {
      assert.throws(() => {
        message.verify(null!, null!, Buffer.from(f.hex, 'hex'), null!);
      }, new RegExp('^Error: ' + f.exception + '$'));
    });
  });
});

describe('verify signature', () => {
  fixtures.invalid.verify.forEach((f) => {
    it(f.description, () => {
      assert.strictEqual(
        message.verify(
          f.message,
          f.address,
          f.signature,
          getMessagePrefix('bitcoin'),
        ),
        false,
      );
    });
  });
});

describe('verify random signature', () => {
  fixtures.randomSig.forEach((f) => {
    it(f.description, () => {
      const keyPair = bitcoin.ECPair.fromWIF(f.wif);
      const privateKey = keyPair.d.toBuffer(32);
      const address = keyPair.getAddress();
      f.signatures.forEach((s) => {
        const signature = message.sign(
          f.message,
          privateKey,
          keyPair.compressed,
          { extraEntropy: Buffer.from(s.sigData, 'base64') },
        );
        assert.strictEqual(message.verify(f.message, address, signature), true);
      });
    });
  });
});

describe('Check that compressed signatures can be verified as segwit', () => {
  const keyPair = bitcoin.ECPair.makeRandom();
  const privateKey = keyPair.d.toBuffer(32);
  const publicKey = keyPair.getPublicKeyBuffer();
  const publicKeyHash = hash160(publicKey);
  const p2shp2wpkhRedeemHash = segwitRedeemHash(publicKeyHash);
  // get addresses (p2pkh, p2sh-p2wpkh, p2wpkh)
  const p2pkhAddress = keyPair.getAddress();
  const p2shp2wpkhAddress = bs58check.encode(
    Buffer.concat([Buffer.from([5]), p2shp2wpkhRedeemHash]),
  );
  const p2wpkhAddress = bech32.encode(
    'bc',
    [0].concat(bech32.toWords(publicKeyHash)),
  );

  const msg = 'Sign me';
  const signature = message.sign(msg, privateKey, true);

  // Make sure it verifies
  assert.strictEqual(message.verify(msg, p2pkhAddress, signature), true);
  // Make sure it verifies even with checkSegwitAlways
  assert.strictEqual(
    message.verify(msg, p2pkhAddress, signature, null, true),
    true,
  );

  // Check segwit addresses with true
  assert.strictEqual(
    message.verify(msg, p2shp2wpkhAddress, signature, null, true),
    true,
  );
  assert.strictEqual(
    message.verify(msg, p2wpkhAddress, signature, null, true),
    true,
  );
  // Check segwit with false
  assert.strictEqual(
    message.verify(msg, p2shp2wpkhAddress, signature) === false,
    true,
  );

  assert.throws(() => {
    message.verify(msg, p2wpkhAddress, signature);
  }, new RegExp('^Error: Non-base58 character$'));

  const signatureUncompressed = message.sign(msg, privateKey, false);
  assert.throws(() => {
    message.verify(msg, p2shp2wpkhAddress, signatureUncompressed, null, true);
  }, new RegExp('^Error: checkSegwitAlways can only be used with a compressed pubkey signature flagbyte$'));
});

describe('Check that invalid segwitType fails', () => {
  const keyPair = bitcoin.ECPair.fromWIF(
    'L3n3e2LggPA5BuhXyBetWGhUfsEBTFe9Y6LhyAhY2mAXkA9jNE56',
  );
  const privateKey = keyPair.d.toBuffer(32);

  assert.throws(() => {
    message.sign('Sign me', privateKey, true, { segwitType: 'XYZ' });
  }, new RegExp('Unrecognized segwitType: use "p2sh\\(p2wpkh\\)" or "p2wpkh"'));
});

describe('Check that Buffers and wrapped Strings are accepted', () => {
  const keyPair = bitcoin.ECPair.fromWIF(
    'L3n3e2LggPA5BuhXyBetWGhUfsEBTFe9Y6LhyAhY2mAXkA9jNE56',
  );
  const privateKey = keyPair.d.toBuffer(32);

  // eslint-disable-next-line no-new-wrappers
  const sig = message.sign(
    Buffer.from('Sign me', 'utf8'),
    privateKey,
    true,
    Buffer.from([1, 2, 3, 4]),
    { segwitType: 'p2wpkh' },
  );
  assert.strictEqual(
    sig.toString('hex'),
    '276e5e5e75196dd93bba7b98f29f944156286d94cb34c376822c6ebc93e08d7b2d177e1f2215b2879caee53f39a376cf350ffdca70df4398a12d5b5adaf3b0f0bc',
  );
});

function segwitRedeemHash(publicKeyHash: Buffer): Buffer {
  const redeemScript = Buffer.concat([
    Buffer.from('0014', 'hex'),
    publicKeyHash,
  ]);
  return hash160(redeemScript);
}
