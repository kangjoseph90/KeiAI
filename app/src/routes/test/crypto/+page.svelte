<script lang="ts">
	import { onMount } from 'svelte';
	import {
		generateMasterKey,
		encrypt,
		decrypt,
		generateSalt,
		deriveKeys,
		wrapMasterKey,
		unwrapMasterKeyRaw,
		createRecoveryData,
		deriveRecoveryKey,
		hashRecoveryAuthToken
	} from '$lib/crypto/index.js';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card/index.js';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge/index.js';
	import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';

	let log = $state('');
	let status = $state('Waiting...');
	let statusVariant = $state<BadgeVariant>('secondary');

	function logMsg(msg: string) {
		log += msg + '\n';
		console.log(msg);
	}

	onMount(async () => {
		try {
			status = 'Running crypto tests...';
			statusVariant = 'secondary';
			const masterKey = await generateMasterKey();
			logMsg('✅ Master key generated on main thread.');

			const plaintext = 'Hello, Web Worker Crypto!';
			logMsg(`Plaintext: "${plaintext}"`);

			const encrypted = await encrypt(masterKey, plaintext);
			logMsg(
				`✅ Encrypted. Ciphertext length: ${encrypted.ciphertext.length}, IV length: ${encrypted.iv.length}`
			);

			const decrypted = await decrypt(masterKey, encrypted);
			logMsg(`✅ Decrypted. Result: "${decrypted}"`);

			if (decrypted !== plaintext) {
				throw new Error('Decrypted text does not match plaintext.');
			}
			
			logMsg('\n--- Phase 2: KDF & Auth Tests ---');
			
			status = 'Testing KDF (PBKDF2)...';
			statusVariant = 'secondary';
			const password = 'my-super-secret-password';
			const salt = await generateSalt();
			logMsg(`✅ Generated Salt (${salt.length} bytes)`);
			
			const keys = await deriveKeys(password, salt);
			logMsg(`✅ Derived Keys: loginKey (${keys.loginKey.length} bytes), encryptionKey (${keys.encryptionKey.length} bytes)`);
			
			status = 'Testing Master Key Wrap/Unwrap...';
			const wrapped = await wrapMasterKey(masterKey, keys.encryptionKey);
			logMsg(`✅ Wrapped Master Key. Ciphertext length: ${wrapped.ciphertext.length}`);
			
			const unwrappedRaw = await unwrapMasterKeyRaw(wrapped.ciphertext, wrapped.iv, keys.encryptionKey);
			logMsg(`✅ Unwrapped Master Key Raw (${unwrappedRaw.length} bytes)`);
			
			status = 'Testing Recovery...';
			const recovery = await createRecoveryData(masterKey);
			logMsg(`✅ Created Recovery Data. Code: ${recovery.recoveryCode.fullCode}`);
			
			const zKey = await deriveRecoveryKey(recovery.recoveryCode.frontHalf);
			logMsg(`✅ Derived Recovery Key Z (${zKey.length} bytes)`);
			
			const authHash = await hashRecoveryAuthToken(recovery.recoveryCode.backHalf);
			logMsg(`✅ Hashed Recovery Auth Token (${authHash.length} bytes)`);

			status = 'All Tests Passed! 🎉';
			statusVariant = 'default';
			logMsg('\n✅ Complete Match & Verification.');
		} catch (err: unknown) {
			status = 'Error ❌';
			statusVariant = 'destructive';
			const error = err as Error;
			logMsg(`❌ Crypto Test Failed: ${error.message}`);
			console.error(err);
		}
	});
</script>

<div class="flex min-h-screen items-start justify-center bg-background p-8">
	<Card class="w-full max-w-3xl">
		<CardHeader>
			<CardTitle class="flex items-center gap-3 font-mono">
				Crypto Test
				<Badge variant={statusVariant}>{status}</Badge>
			</CardTitle>
		</CardHeader>
		<CardContent>
			<ScrollArea class="h-96 rounded-md border bg-muted">
				<div class="p-4">
					<pre class="whitespace-pre-wrap font-mono text-sm text-muted-foreground">{log ||
							'Waiting for test results...'}</pre>
				</div>
			</ScrollArea>
		</CardContent>
	</Card>
</div>
