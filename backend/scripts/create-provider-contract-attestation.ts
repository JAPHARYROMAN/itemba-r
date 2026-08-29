/**
 * Produces the signed provider-contract attestation that Msaidizi requires
 * before it will talk to the model API at all.
 *
 * This is an OPERATOR tool, not part of the running service. The private key it
 * signs with is yours and is never loaded by the backend - the runtime only ever
 * reads the public half and re-verifies the artifact before every request.
 *
 * It deliberately imports the same `signProviderContractAttestation` the
 * verifier is written against, rather than re-implementing canonical JSON and
 * the ES256 signing input. A second implementation of those would be a second
 * thing to keep correct, and the first sign of it being wrong would be a
 * production backend refusing to start.
 *
 * Having signed, it immediately verifies its own output through the real
 * verifier with the exact values it is about to print. If that fails, nothing
 * is written: an attestation that does not verify is worse than none, because
 * you find out when the service will not boot.
 *
 *   npm run attestation:create -- --help
 */

import { createHash, generateKeyPairSync } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ANTHROPIC_API_ORIGIN,
  PROVIDER_CONTRACT_ATTESTATION,
  REQUIRED_PROVIDER_DATA_CLASSES,
  signProviderContractAttestation,
  verifyProviderContractAttestation,
} from '../src/modules/msaidizi/provider-contract-attestation.protocol';
import type { ProviderContractClaims } from '../src/modules/msaidizi/provider-contract-attestation.protocol';

type Args = Record<string, string | undefined>;

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const eq = token.indexOf('=');
    if (eq !== -1) {
      args[token.slice(2, eq)] = token.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      args[token.slice(2)] = next && !next.startsWith('--') ? ((i += 1), next) : 'true';
    }
  }
  return args;
}

function required(args: Args, name: string): string {
  const value = args[name];
  if (!value || value === 'true') {
    throw new Error(`--${name} is required. Run with --help for the full list.`);
  }
  return value;
}

function sha256Hex(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

const HELP = `
Create the signed Msaidizi provider-contract attestation.

  --generate-key <path>       Write a fresh P-256 keypair (<path>.key.pem /
                              <path>.pub.pem) and exit. Do this once, keep the
                              private half offline, and never commit either.

Signing a contract:
  --private-key <path>        P-256 private key PEM (operator-held).
  --public-key <path>         Its public half. Installed on the host.
  --key-id <id>               Your label for this signing key. Goes in the
                              artifact and must match MSAIDIZI_PROVIDER_CONTRACT_KEY_ID.
  --contract-document <path>  The actual agreement covering zero-retention and
                              no-training. Its SHA-256 is bound into the claims,
                              so the attestation names one exact document.
  --account-id <id>           Your Anthropic account identifier.
  --credential-key-id <id>    Secret-manager label for the API key in use. Never
                              the key itself. Must match
                              MSAIDIZI_PROVIDER_CREDENTIAL_KEY_ID.
  --models <a,b>              Every model the deployment may reach. Must include
                              MSAIDIZI_MODEL and MSAIDIZI_CLASSIFIER_MODEL.
  --expires <ISO-8601>        When this attestation stops being accepted.
  --out <path>                Where to write the artifact.

Optional:
  --attestation-id <id>       Defaults to a timestamped identifier.
  --effective <ISO-8601>      Defaults to now.
  --issued <ISO-8601>         Defaults to now.
`;

function generateKeypair(pathPrefix: string): void {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const keyPath = `${pathPrefix}.key.pem`;
  const pubPath = `${pathPrefix}.pub.pem`;
  writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  writeFileSync(pubPath, publicKey.export({ type: 'spki', format: 'pem' }));
  process.stdout.write(
    `Wrote ${keyPath} (mode 600) and ${pubPath}.\n` +
      `Keep the private key OFF the application host. Only the .pub.pem is installed.\n`,
  );
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  if (args['generate-key']) {
    generateKeypair(resolve(required(args, 'generate-key')));
    return;
  }

  const privateKeyPem = readFileSync(resolve(required(args, 'private-key')), 'utf8');
  const publicKeyPem = readFileSync(resolve(required(args, 'public-key')), 'utf8');
  const keyId = required(args, 'key-id');
  const contractDocument = readFileSync(resolve(required(args, 'contract-document')));
  const apiAccountId = required(args, 'account-id');
  const apiCredentialKeyId = required(args, 'credential-key-id');
  // Sorted and deduped here rather than demanded of the caller: the verifier
  // requires canonical order, and a comma-separated flag is exactly the place a
  // person would get that wrong and then have to decode the error.
  const permittedModelIds = [
    ...new Set(
      required(args, 'models')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ].sort();
  const outPath = resolve(required(args, 'out'));

  const now = new Date();
  const issuedAt = args.issued ?? now.toISOString();
  const effectiveAt = args.effective ?? now.toISOString();
  const expiresAt = required(args, 'expires');

  const contractDocumentSha256 = sha256Hex(contractDocument);

  const claims: ProviderContractClaims = {
    attestationId: args['attestation-id'] ?? `itemba-msaidizi-${now.toISOString().slice(0, 10)}`,
    provider: 'anthropic',
    apiOrigin: ANTHROPIC_API_ORIGIN,
    apiAccountId,
    apiCredentialKeyId,
    permittedModelIds,
    // The full set is required: the attestation covers every class of data the
    // agent could put in front of the provider, not a subset someone chose.
    coveredDataClasses: [...REQUIRED_PROVIDER_DATA_CLASSES],
    zeroTraining: true,
    providerRetentionSeconds: 0,
    contractDocumentSha256,
    // Content-addressed on purpose. The reference cannot drift from the document
    // it refers to, because it IS the document's digest.
    immutableLegalReference: `urn:sha256:${contractDocumentSha256}`,
    issuedAt,
    effectiveAt,
    expiresAt,
  };

  const artifact = signProviderContractAttestation(claims, privateKeyPem, keyId);
  const artifactBytes = Buffer.from(artifact, 'utf8');
  const artifactSha256 = sha256Hex(artifactBytes);
  const signerSpkiSha256 = sha256Hex(createPublicKeyDer(publicKeyPem));

  // Prove it before writing it. These are the exact values about to be printed,
  // so a pass here means the running service will accept the file as-is.
  verifyProviderContractAttestation(artifactBytes, {
    publicKeyPem,
    expectedKeyId: keyId,
    expectedArtifactSha256: artifactSha256,
    expectedSignerSpkiSha256: signerSpkiSha256,
    expectedProvider: 'anthropic',
    expectedApiOrigin: ANTHROPIC_API_ORIGIN,
    expectedApiAccountId: apiAccountId,
    expectedApiCredentialKeyId: apiCredentialKeyId,
    expectedModelIds: permittedModelIds,
  });

  writeFileSync(outPath, artifact, { encoding: 'utf8' });

  process.stdout.write(
    `\nVerified and wrote ${outPath}\n` +
      `Contract: ${PROVIDER_CONTRACT_ATTESTATION}\n` +
      `Expires:  ${expiresAt}\n\n` +
      `Install the artifact and the PUBLIC key on the host, then set:\n\n` +
      `MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_PATH=<host path to ${outPath.split(/[\\/]/).pop()}>\n` +
      `MSAIDIZI_PROVIDER_CONTRACT_PUBLIC_KEY_PATH=<host path to the .pub.pem>\n` +
      `MSAIDIZI_PROVIDER_CONTRACT_KEY_ID=${keyId}\n` +
      `MSAIDIZI_PROVIDER_CONTRACT_ATTESTATION_SHA256=${artifactSha256}\n` +
      `MSAIDIZI_PROVIDER_CONTRACT_SIGNER_SPKI_SHA256=${signerSpkiSha256}\n` +
      `MSAIDIZI_PROVIDER_ACCOUNT_ID=${apiAccountId}\n` +
      `MSAIDIZI_PROVIDER_CREDENTIAL_KEY_ID=${apiCredentialKeyId}\n\n` +
      `The private key is not needed on the host and should not be copied there.\n`,
  );
}

function createPublicKeyDer(publicKeyPem: string): Buffer {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createPublicKey } = require('node:crypto') as typeof import('node:crypto');
  return createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' }) as Buffer;
}

try {
  main();
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
}
