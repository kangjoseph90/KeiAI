<script lang="ts">
    import {
        Camera,
        CameraOff,
        LoaderCircle,
        Pause,
        Play,
        RotateCcw,
        Square,
        Video
    } from 'lucide-svelte';
    import { onDestroy, tick } from 'svelte';
    import {
        appCamera,
        type CameraCapture,
        type CameraMode,
        type CameraVideoRecording
    } from '$lib/adapters/camera';
    import { Button } from '$lib/components/ui/button';
    import {
        Dialog,
        DialogContent,
        DialogDescription,
        DialogHeader,
        DialogTitle
    } from '$lib/components/ui/dialog';
    import { getErrorMessage } from '$lib/types/errors';

    type CameraPhase =
        | 'starting'
        | 'preview'
        | 'preparing'
        | 'recording'
        | 'paused'
        | 'stopping'
        | 'captured'
        | 'error';

    const MAX_VIDEO_DURATION_MS = 60_000;

    let {
        open = $bindable(false),
        onAttach
    }: {
        open?: boolean;
        onAttach: (file: File) => Promise<void>;
    } = $props();

    let phase = $state<CameraPhase>('starting');
    let captureMode = $state<CameraMode>('photo');
    let videoElement = $state<HTMLVideoElement>();
    let capture: CameraCapture | null = null;
    let controller: AbortController | null = null;
    let videoRecording: CameraVideoRecording | null = null;
    let capturedFile = $state<File | null>(null);
    let previewUrl = $state<string | null>(null);
    let errorMessage = $state<string | null>(null);
    let takingPhoto = $state(false);
    let attaching = $state(false);
    let changingRecordingState = $state(false);
    let elapsedMs = $state(0);
    let accumulatedRecordingMs = 0;
    let recordingStartedAt = 0;
    let recordingInterval: ReturnType<typeof setInterval> | null = null;
    let recordingTimeout: ReturnType<typeof setTimeout> | null = null;
    let startVersion = 0;
    let wasOpen = false;

    const capturedLabel = $derived(captureMode === 'photo' ? 'photo' : 'video');

    $effect(() => {
        if (open === wasOpen) return;
        wasOpen = open;
        if (open) void startPreview();
        else resetCapture();
    });

    onDestroy(resetCapture);

    function stopRecordingClock(): void {
        if (recordingInterval) clearInterval(recordingInterval);
        if (recordingTimeout) clearTimeout(recordingTimeout);
        recordingInterval = null;
        recordingTimeout = null;
        recordingStartedAt = 0;
    }

    function resetRecordingClock(): void {
        stopRecordingClock();
        accumulatedRecordingMs = 0;
        elapsedMs = 0;
    }

    function updateElapsedTime(): void {
        if (recordingStartedAt === 0) return;
        elapsedMs = Math.min(
            accumulatedRecordingMs + Date.now() - recordingStartedAt,
            MAX_VIDEO_DURATION_MS
        );
    }

    function startRecordingClock(): void {
        recordingStartedAt = Date.now();
        updateElapsedTime();
        recordingInterval = setInterval(updateElapsedTime, 250);
        recordingTimeout = setTimeout(
            finishRecordingAtLimit,
            Math.max(0, MAX_VIDEO_DURATION_MS - accumulatedRecordingMs)
        );
    }

    function finishRecordingAtLimit(): void {
        updateElapsedTime();
        if (changingRecordingState) {
            recordingTimeout = setTimeout(finishRecordingAtLimit, 100);
            return;
        }
        void finishVideoRecording();
    }

    function pauseRecordingClock(): void {
        if (recordingStartedAt !== 0) {
            accumulatedRecordingMs = Math.min(
                accumulatedRecordingMs + Date.now() - recordingStartedAt,
                MAX_VIDEO_DURATION_MS
            );
            elapsedMs = accumulatedRecordingMs;
        }
        stopRecordingClock();
    }

    function stopPreview(): void {
        stopRecordingClock();
        videoRecording?.cancel();
        videoRecording = null;
        controller?.abort();
        controller = null;
        capture?.stop();
        capture = null;
        if (videoElement) videoElement.srcObject = null;
    }

    function clearCapturedMedia(): void {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = null;
        capturedFile = null;
    }

    function resetCapture(): void {
        startVersion += 1;
        stopPreview();
        clearCapturedMedia();
        captureMode = 'photo';
        phase = 'starting';
        errorMessage = null;
        takingPhoto = false;
        attaching = false;
        changingRecordingState = false;
        resetRecordingClock();
    }

    function isCurrentSession(version: number): boolean {
        return open && version === startVersion;
    }

    function isCurrentCapture(version: number, expectedCapture: CameraCapture): boolean {
        return isCurrentSession(version) && capture === expectedCapture;
    }

    async function startPreview(): Promise<void> {
        const version = ++startVersion;
        stopPreview();
        clearCapturedMedia();
        phase = 'starting';
        errorMessage = null;
        takingPhoto = false;
        changingRecordingState = false;
        resetRecordingClock();

        const nextController = new AbortController();
        controller = nextController;
        try {
            const nextCapture = await appCamera.start({ signal: nextController.signal });
            if (!open || version !== startVersion) {
                nextCapture.stop();
                return;
            }

            capture = nextCapture;
            await tick();
            if (!videoElement || !open || version !== startVersion) {
                nextCapture.stop();
                return;
            }
            videoElement.srcObject = nextCapture.stream;
            await videoElement.play();
            if (!isCurrentCapture(version, nextCapture)) {
                nextCapture.stop();
                return;
            }
            if (videoElement.videoWidth > 0 && videoElement.videoHeight > 0) phase = 'preview';
        } catch (error) {
            if (nextController.signal.aborted || !open || version !== startVersion) return;
            stopPreview();
            errorMessage = getErrorMessage(error, 'Could not start the camera');
            phase = 'error';
        }
    }

    function handlePreviewReady(): void {
        if (
            !capture ||
            !videoElement ||
            videoElement.srcObject !== capture.stream ||
            !open ||
            phase !== 'starting'
        ) {
            return;
        }
        void videoElement?.play().catch(() => undefined);
        phase = 'preview';
    }

    function changeMode(mode: CameraMode): void {
        if (mode === captureMode || phase !== 'preview' || takingPhoto) return;
        captureMode = mode;
        errorMessage = null;
    }

    function handlePhotoAction(): void {
        if (captureMode !== 'photo') {
            changeMode('photo');
            return;
        }
        void takePhoto();
    }

    function handleVideoAction(): void {
        if (captureMode !== 'video') {
            changeMode('video');
            return;
        }
        void startVideoRecording();
    }

    function setCapturedFile(file: File): void {
        clearCapturedMedia();
        capturedFile = file;
        previewUrl = URL.createObjectURL(file);
        stopPreview();
        phase = 'captured';
    }

    async function takePhoto(): Promise<void> {
        if (
            !capture ||
            !videoElement ||
            captureMode !== 'photo' ||
            phase !== 'preview' ||
            takingPhoto
        ) {
            return;
        }
        const currentCapture = capture;
        const currentVideoElement = videoElement;
        const version = startVersion;
        takingPhoto = true;
        errorMessage = null;
        try {
            const file = await currentCapture.takePhoto(currentVideoElement);
            if (!isCurrentCapture(version, currentCapture) || captureMode !== 'photo') return;
            setCapturedFile(file);
        } catch (error) {
            if (!isCurrentCapture(version, currentCapture)) return;
            errorMessage = getErrorMessage(error, 'Could not take the photo');
            stopPreview();
            phase = 'error';
        } finally {
            if (version === startVersion) takingPhoto = false;
        }
    }

    async function startVideoRecording(): Promise<void> {
        if (!capture || captureMode !== 'video' || phase !== 'preview') return;
        const currentCapture = capture;
        errorMessage = null;
        resetRecordingClock();
        phase = 'preparing';
        try {
            const recording = await currentCapture.startVideoRecording();
            if (!open || capture !== currentCapture) {
                recording.cancel();
                return;
            }
            videoRecording = recording;
            startRecordingClock();
            phase = 'recording';
            void recording.failure.catch((error) => {
                if (videoRecording !== recording) return;
                videoRecording = null;
                stopRecordingClock();
                changingRecordingState = false;
                errorMessage = getErrorMessage(error, 'Video recording failed');
                stopPreview();
                phase = 'error';
            });
        } catch (error) {
            if (!open || capture !== currentCapture) return;
            errorMessage = getErrorMessage(error, 'Could not start video recording');
            phase = 'preview';
        }
    }

    async function pauseVideoRecording(): Promise<void> {
        const recording = videoRecording;
        if (!recording || phase !== 'recording' || changingRecordingState) return;
        changingRecordingState = true;
        errorMessage = null;
        try {
            await recording.pause();
            if (videoRecording !== recording) return;
            pauseRecordingClock();
            phase = 'paused';
        } catch (error) {
            if (videoRecording !== recording) return;
            errorMessage = getErrorMessage(error, 'Could not pause video recording');
            stopPreview();
            phase = 'error';
        } finally {
            changingRecordingState = false;
            if (videoRecording === recording && elapsedMs >= MAX_VIDEO_DURATION_MS) {
                void finishVideoRecording();
            }
        }
    }

    async function resumeVideoRecording(): Promise<void> {
        const recording = videoRecording;
        if (!recording || phase !== 'paused' || changingRecordingState) return;
        changingRecordingState = true;
        errorMessage = null;
        try {
            await recording.resume();
            if (videoRecording !== recording) return;
            startRecordingClock();
            phase = 'recording';
        } catch (error) {
            if (videoRecording !== recording) return;
            errorMessage = getErrorMessage(error, 'Could not resume video recording');
            stopPreview();
            phase = 'error';
        } finally {
            changingRecordingState = false;
            if (videoRecording === recording && elapsedMs >= MAX_VIDEO_DURATION_MS) {
                void finishVideoRecording();
            }
        }
    }

    async function finishVideoRecording(): Promise<void> {
        const recording = videoRecording;
        if (!recording || (phase !== 'recording' && phase !== 'paused') || changingRecordingState) {
            return;
        }
        const currentCapture = capture;
        const version = startVersion;
        videoRecording = null;
        if (phase === 'recording') pauseRecordingClock();
        else stopRecordingClock();
        phase = 'stopping';
        try {
            const file = await recording.finish();
            if (!currentCapture || !isCurrentCapture(version, currentCapture)) return;
            setCapturedFile(file);
        } catch (error) {
            if (!currentCapture || !isCurrentCapture(version, currentCapture)) return;
            errorMessage = getErrorMessage(error, 'Could not finish video recording');
            stopPreview();
            phase = 'error';
        }
    }

    async function attachMedia(): Promise<void> {
        if (!capturedFile || attaching) return;
        const file = capturedFile;
        const version = startVersion;
        const label = capturedLabel;
        attaching = true;
        errorMessage = null;
        try {
            await onAttach(file);
            if (isCurrentSession(version) && capturedFile === file) open = false;
        } catch (error) {
            if (!isCurrentSession(version) || capturedFile !== file) return;
            errorMessage = getErrorMessage(error, `Could not attach the ${label}`);
        } finally {
            if (version === startVersion) attaching = false;
        }
    }

    async function chooseMedia(): Promise<void> {
        const version = startVersion;
        const mode = captureMode;
        const label = capturedLabel;
        errorMessage = null;
        try {
            const file =
                mode === 'photo' ? await appCamera.pickPhoto() : await appCamera.pickVideo();
            if (!file || !isCurrentSession(version)) return;
            setCapturedFile(file);
        } catch (error) {
            if (!isCurrentSession(version)) return;
            errorMessage = getErrorMessage(error, `Could not choose a ${label}`);
        }
    }

    function formatDuration(durationMs: number): string {
        const totalSeconds = Math.floor(durationMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
</script>

<Dialog bind:open>
    <DialogContent
        class="max-h-[calc(100vh-1rem)] w-[calc(100%-1rem)] max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-2xl"
    >
        <DialogHeader class="border-b px-5 py-4 pr-12 text-left">
            <DialogTitle class="text-base">Capture media</DialogTitle>
            <DialogDescription class="text-xs">
                Take a photo or record up to 60 seconds, then review it before attaching.
            </DialogDescription>
        </DialogHeader>

        <div
            class="relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-black aspect-4/3 max-h-[min(70vh,42rem)]"
        >
            {#if phase === 'captured' && previewUrl}
                {#if captureMode === 'photo'}
                    <img src={previewUrl} alt="Captured preview" class="size-full object-contain" />
                {:else}
                    <!-- svelte-ignore a11y_media_has_caption -->
                    <video
                        src={previewUrl}
                        aria-label="Recorded video preview"
                        class="size-full object-contain"
                        controls
                        playsinline
                    ></video>
                {/if}
            {:else}
                <video
                    bind:this={videoElement}
                    aria-label="Camera preview"
                    class="size-full object-contain transition-opacity duration-200 {phase ===
                        'preview' ||
                    phase === 'preparing' ||
                    phase === 'recording' ||
                    phase === 'paused'
                        ? 'opacity-100'
                        : 'opacity-35'}"
                    autoplay
                    muted
                    playsinline
                    onloadedmetadata={handlePreviewReady}
                ></video>

                {#if phase === 'starting'}
                    <div
                        class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white"
                        role="status"
                    >
                        <LoaderCircle class="size-7 animate-spin" />
                        <span class="text-sm">Starting camera…</span>
                    </div>
                {:else if phase === 'stopping'}
                    <div
                        class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/45 text-white"
                        role="status"
                    >
                        <LoaderCircle class="size-7 animate-spin" />
                        <span class="text-sm">Preparing video…</span>
                    </div>
                {:else if phase === 'error'}
                    <div
                        class="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center"
                        role="alert"
                    >
                        <div
                            class="flex size-12 items-center justify-center rounded-full bg-white/10 text-white"
                        >
                            <CameraOff class="size-6" />
                        </div>
                        <div>
                            <p class="text-sm font-medium text-white">Camera unavailable</p>
                            <p class="mt-1 text-xs leading-relaxed text-white/65">
                                {errorMessage ?? 'Check camera access and try again.'}
                            </p>
                        </div>
                    </div>
                {/if}

                {#if phase === 'recording' || phase === 'paused'}
                    <div
                        class="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/65 px-3 py-1.5 font-mono text-xs text-white shadow-sm backdrop-blur"
                        role="status"
                    >
                        <span
                            class="size-2 rounded-full bg-recording {phase === 'recording'
                                ? 'animate-pulse'
                                : ''}"
                        ></span>
                        {#if phase === 'paused'}
                            <span class="font-sans text-[11px] font-medium">Paused</span>
                        {/if}
                        <span>{formatDuration(elapsedMs)} / 01:00</span>
                    </div>
                {/if}

                {#if phase === 'preview' && errorMessage}
                    <div
                        class="absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] rounded-md bg-black/70 px-2.5 py-1.5 text-xs text-white shadow-sm backdrop-blur"
                        role="alert"
                    >
                        {errorMessage}
                    </div>
                {/if}

                <div class="pointer-events-none absolute inset-4" aria-hidden="true">
                    <span class="absolute left-0 top-0 size-5 border-l border-t border-white/45"
                    ></span>
                    <span class="absolute right-0 top-0 size-5 border-r border-t border-white/45"
                    ></span>
                    <span class="absolute bottom-0 left-0 size-5 border-b border-l border-white/45"
                    ></span>
                    <span class="absolute bottom-0 right-0 size-5 border-b border-r border-white/45"
                    ></span>
                </div>
            {/if}
        </div>

        <div class="flex h-22 shrink-0 items-center border-t px-5 py-3">
            {#if phase === 'captured'}
                <div class="flex w-full items-center justify-between gap-3">
                    <Button
                        variant="outline"
                        onclick={() => void startPreview()}
                        disabled={attaching}
                    >
                        <RotateCcw class="size-4" />
                        {captureMode === 'photo' ? 'Retake' : 'Record again'}
                    </Button>
                    <div class="flex min-w-0 flex-col items-end gap-1">
                        {#if errorMessage}
                            <span class="max-w-64 truncate text-xs text-destructive"
                                >{errorMessage}</span
                            >
                        {/if}
                        <Button onclick={() => void attachMedia()} disabled={attaching}>
                            {#if attaching}
                                <LoaderCircle class="size-4 animate-spin" />
                                Attaching…
                            {:else}
                                {#if captureMode === 'photo'}
                                    <Camera class="size-4" />
                                {:else}
                                    <Video class="size-4" />
                                {/if}
                                Attach {capturedLabel}
                            {/if}
                        </Button>
                    </div>
                </div>
            {:else if phase === 'error'}
                <div class="flex w-full items-center justify-between gap-3">
                    <Button variant="outline" onclick={() => void chooseMedia()}>
                        Choose {capturedLabel}
                    </Button>
                    <Button variant="secondary" onclick={() => void startPreview()}>
                        <RotateCcw class="size-4" />
                        Try camera again
                    </Button>
                </div>
            {:else}
                <div class="flex w-full items-center justify-center gap-4">
                    {#if phase === 'preparing'}
                        <span class="sr-only" role="status">Preparing video recording</span>
                    {/if}
                    {#if phase === 'stopping'}
                        <div
                            class="flex size-16 items-center justify-center rounded-full border-2 border-border bg-background"
                            role="status"
                            aria-label="Preparing video"
                        >
                            <LoaderCircle class="size-5 animate-spin text-muted-foreground" />
                        </div>
                    {:else if phase === 'recording' || phase === 'paused'}
                        <button
                            type="button"
                            class="flex size-11 items-center justify-center rounded-full border border-border/80 bg-muted text-foreground shadow-sm transition hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
                            disabled={changingRecordingState}
                            aria-label={phase === 'recording'
                                ? 'Pause video recording'
                                : 'Resume video recording'}
                            onclick={() =>
                                void (phase === 'recording'
                                    ? pauseVideoRecording()
                                    : resumeVideoRecording())}
                        >
                            {#if changingRecordingState}
                                <LoaderCircle class="size-4 animate-spin" />
                            {:else if phase === 'recording'}
                                <Pause class="size-5 fill-current" />
                            {:else}
                                <Play class="ml-0.5 size-5 fill-current" />
                            {/if}
                        </button>
                        <button
                            type="button"
                            class="group flex size-16 items-center justify-center rounded-full border-2 border-recording/70 bg-background p-1.5 shadow-sm transition hover:border-recording focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-recording focus-visible:ring-offset-2"
                            disabled={changingRecordingState}
                            aria-label="Stop video recording"
                            onclick={() => void finishVideoRecording()}
                        >
                            <span
                                class="flex size-full items-center justify-center rounded-full bg-recording text-white transition-transform group-hover:scale-95 group-active:scale-90"
                            >
                                <Square class="size-5 fill-current" />
                            </span>
                        </button>
                    {:else}
                        <button
                            type="button"
                            class="group flex items-center justify-center rounded-full border bg-background shadow-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45 {captureMode ===
                            'photo'
                                ? 'size-16 border-foreground/35 p-1.5'
                                : 'size-11 border-border/80 text-muted-foreground hover:border-foreground/30 hover:text-foreground'}"
                            disabled={phase !== 'preview' || takingPhoto}
                            aria-label={captureMode === 'photo'
                                ? 'Take photo'
                                : 'Select photo mode'}
                            onclick={handlePhotoAction}
                        >
                            {#if captureMode === 'photo'}
                                <span
                                    class="flex size-full items-center justify-center rounded-full bg-foreground text-background transition-transform group-hover:scale-95 group-active:scale-90"
                                >
                                    {#if takingPhoto}
                                        <LoaderCircle class="size-5 animate-spin" />
                                    {:else}
                                        <Camera class="size-6" />
                                    {/if}
                                </span>
                            {:else}
                                <Camera class="size-5" />
                            {/if}
                        </button>
                        <button
                            type="button"
                            class="group flex items-center justify-center rounded-full border bg-background shadow-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45 {captureMode ===
                            'video'
                                ? 'size-16 border-foreground/35 p-1.5'
                                : 'size-11 border-border/80 text-muted-foreground hover:border-foreground/30 hover:text-foreground'}"
                            disabled={phase !== 'preview' || takingPhoto}
                            aria-label={captureMode === 'video'
                                ? phase === 'preparing'
                                    ? 'Preparing video recording'
                                    : 'Start video recording'
                                : 'Select video mode'}
                            onclick={handleVideoAction}
                        >
                            {#if captureMode === 'video'}
                                <span
                                    class="flex size-full items-center justify-center rounded-full bg-foreground text-background transition-transform group-hover:scale-95 group-active:scale-90"
                                >
                                    {#if phase === 'preparing'}
                                        <LoaderCircle class="size-5 animate-spin" />
                                    {:else}
                                        <Video class="size-6" />
                                    {/if}
                                </span>
                            {:else}
                                <Video class="size-5" />
                            {/if}
                        </button>
                    {/if}
                </div>
            {/if}
        </div>
    </DialogContent>
</Dialog>
