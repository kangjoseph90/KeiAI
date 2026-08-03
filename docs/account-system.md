# KeiAI Account System

A KeiAI identity is created locally. A server account connects that identity to encrypted sync; it does not create or own the identity.

## Identity

The local `UserRecord` owns:

- a stable `userId`
- master key `M`
- an identity key pair
- local profile fields
- device-local server and proxy settings
- an optional username for the selected sync server

`M` encrypts synchronized records and the server profile. It remains portable so the same identity can be restored, paired to another device, or connected to another server. The identity key pair exchanges multi-room keys: the public key is discoverable through the server, while the private key is encrypted with `M`.

An active room adds `roomId` and its room key to the active user session. It does not replace the user identity.

## Server account

The client derives two independent values from the user's password and the server-provided salt:

- `X`: PocketBase login credential
- `Y`: wraps `M` for storage as `M(Y)`

The server stores the PocketBase password hash, salt, encrypted key bundles, public identity key, and encrypted profile. It does not receive the raw password, `Y`, `M`, or the private identity key in plaintext.

Creating an account uses the local `userId` as the PocketBase record ID. Signing in restores that canonical identity and its encrypted key material rather than creating another local identity.

PocketBase auth tokens are stored per `userId × serverUrl`. Logging out clears the active server token but keeps the local identity and its server link. Server and proxy selection lives in `UserRecord.connections` and is not synchronized.

## Recovery and password changes

A recovery code has two independent halves:

- the front half derives `Z`, which decrypts `M(Z)`
- the back half is hashed for server lookup and authorization

Recovery restores `M`, sets a new password, and replaces the recovery code. Changing the password also rewraps `M` and replaces the recovery code without changing `M` or the local identity.

Deleting a remote account with a recovery code removes its server data but keeps the local identity and local content.

## Device pairing

Pairing derives separate lookup and encryption keys from a short-lived pairing code. The server receives only the lookup ID and an encrypted one-time blob containing the portable identity. A successful lookup consumes the blob.

The receiving device restores the same `userId`, `M`, identity key pair, and current server connection. If the transferred PocketBase token is still valid, synchronization resumes without another login.

## Invariants

- Local identity exists independently of any server account.
- `M` does not change when the password, device, or server changes.
- Server selection and authentication are separate state: changing a connection does not authenticate it.
- Email is optional metadata and is never an authentication or recovery dependency.
- Recovery and pairing transfer the existing identity; they do not create a new one.
- Multi-room membership uses the identity key pair to distribute room keys without exposing them to the server.

The concrete PocketBase collections and endpoints are documented in [`../pocketbase/AGENTS.md`](../pocketbase/AGENTS.md).
