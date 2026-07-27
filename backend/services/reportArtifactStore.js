const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class ReportArtifactStoreError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ReportArtifactStoreError';
    this.code = code;
  }
}

function configuredRoot(options = {}) {
  const root = options.root || process.env.REPORT_ARTIFACT_DIRECTORY;
  if (!root || !path.isAbsolute(root)) throw new ReportArtifactStoreError('ARTIFACT_STORE_UNAVAILABLE');
  return root;
}

function safeIdentity(identity) {
  if (!/^report-artifact-[a-f0-9-]{16,80}\.html$/.test(identity || '')) {
    throw new ReportArtifactStoreError('ARTIFACT_IDENTITY_INVALID');
  }
  return identity;
}

function checksum(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function createArtifactStore(options = {}) {
  const root = configuredRoot(options);
  return Object.freeze({
    async putImmutable({ identity, bytes }) {
      safeIdentity(identity);
      if (!Buffer.isBuffer(bytes)) throw new ReportArtifactStoreError('ARTIFACT_BYTES_INVALID');
      await fs.promises.mkdir(root, { recursive: true, mode: 0o700 });
      const target = path.join(root, identity);
      try {
        await fs.promises.writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = await fs.promises.readFile(target);
        if (!existing.equals(bytes)) throw new ReportArtifactStoreError('ARTIFACT_IMMUTABILITY_VIOLATION');
      }
      return Object.freeze({ storageIdentity: identity, byteLength: bytes.length, checksum: checksum(bytes) });
    },
    async readVerified({ identity, expectedChecksum }) {
      safeIdentity(identity);
      let bytes;
      try {
        bytes = await fs.promises.readFile(path.join(root, identity));
      } catch (_) {
        throw new ReportArtifactStoreError('ARTIFACT_UNAVAILABLE');
      }
      if (checksum(bytes) !== expectedChecksum) throw new ReportArtifactStoreError('ARTIFACT_VERIFICATION_FAILED');
      return bytes;
    },
    async deleteControlled({ identity }) {
      safeIdentity(identity);
      try {
        await fs.promises.unlink(path.join(root, identity));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      return Object.freeze({ deleted: true });
    }
  });
}

module.exports = { ReportArtifactStoreError, checksum, createArtifactStore };
