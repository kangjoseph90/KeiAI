<script lang="ts">
	import { onMount } from 'svelte';
	import { cryptoWorker } from '$lib/workers/index.js';
	import { generateMasterKey } from '$lib/crypto/index.js';

	let log = '';
	let status = 'Waiting...';

	function logMsg(msg: string) {
		log += msg + '\n';
		console.log(msg);
	}

	onMount(async () => {
		try {
			status = 'Running worker tests...';
			const masterKey = await generateMasterKey();
			logMsg('✅ Master key generated on main thread.');

			const plaintext = 'Hello, Web Worker Crypto!';
			logMsg(`Plaintext: "${plaintext}"`);

			const encrypted = await cryptoWorker.encrypt(masterKey, plaintext);
			logMsg(
				`✅ Encrypted via Worker. Ciphertext length: ${encrypted.ciphertext.length}, IV length: ${encrypted.iv.length}`
			);

			const decrypted = await cryptoWorker.decrypt(masterKey, encrypted);
			logMsg(`✅ Decrypted via Worker. Result: "${decrypted}"`);

			if (decrypted !== plaintext) {
				throw new Error('Decrypted text does not match plaintext.');
			}

			logMsg('\n--- Phase 2: KDF & Auth Tests ---');

			status = 'Testing KDF (PBKDF2)...';
			const password = 'my-super-secret-password';
			const salt = await cryptoWorker.generateSalt();
			logMsg(`✅ Generated Salt (${salt.length} bytes)`);

			const keys = await cryptoWorker.deriveKeys(password, salt);
			logMsg(
				`✅ Derived Keys: loginKey (${keys.loginKey.length} bytes), encryptionKey (${keys.encryptionKey.length} bytes)`
			);

			status = 'Testing Master Key Wrap/Unwrap...';
			const wrapped = await cryptoWorker.wrapMasterKey(masterKey, keys.encryptionKey);
			logMsg(`✅ Wrapped Master Key. Ciphertext length: ${wrapped.ciphertext.length}`);

			const unwrappedRaw = await cryptoWorker.unwrapMasterKeyRaw(
				wrapped.ciphertext,
				wrapped.iv,
				keys.encryptionKey
			);
			logMsg(`✅ Unwrapped Master Key Raw (${unwrappedRaw.length} bytes)`);

			status = 'Testing Recovery...';
			const recovery = await cryptoWorker.createRecoveryData(masterKey);
			logMsg(`✅ Created Recovery Data. Code: ${recovery.recoveryCode.fullCode}`);

			const zKey = await cryptoWorker.deriveRecoveryKey(recovery.recoveryCode.frontHalf);
			logMsg(`✅ Derived Recovery Key Z (${zKey.length} bytes)`);

			const authHash = await cryptoWorker.hashRecoveryAuthToken(recovery.recoveryCode.backHalf);
			logMsg(`✅ Hashed Recovery Auth Token (${authHash.length} bytes)`);

			status = 'All Tests Passed! 🎉';
			logMsg('\n✅ Complete Match & Verification.');
		} catch (err: unknown) {
			status = 'Error ❌';
			const error = err as Error;
			logMsg(`❌ Worker Test Failed: ${error.message}`);
			console.error(err);
		}
	});
</script>

<div class="p-8 font-mono text-sm">
	<h1 class="text-xl font-bold mb-4">Crypto Worker Test</h1>
	<p
		class="font-bold mb-4"
		class:text-green-500={status.includes('Success')}
		class:text-red-500={status.includes('Error')}
	>
		{status}
	</p>

	<pre class="bg-gray-900 text-gray-100 p-4 rounded whitespace-pre-wrap">{log}</pre>
</div>
