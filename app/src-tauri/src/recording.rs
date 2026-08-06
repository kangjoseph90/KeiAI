use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream, StreamConfig};
use serde::Serialize;
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, Response};
use tauri::State;

const LEVEL_INTERVAL: Duration = Duration::from_millis(50);

pub struct RecordingState {
    active: Option<ActiveRecording>,
}

impl RecordingState {
    pub fn new() -> Self {
        Self { active: None }
    }
}

struct ActiveRecording {
    id: String,
    commands: mpsc::Sender<RecordingCommand>,
}

enum RecordingCommand {
    Finish(mpsc::SyncSender<Result<Vec<u8>, String>>),
    Cancel(mpsc::SyncSender<()>),
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum RecordingEvent {
    Level { level: f32 },
    Error { message: String },
}

#[tauri::command]
pub fn start_audio_recording(
    recording_id: String,
    events: Channel<RecordingEvent>,
    state: State<'_, Mutex<RecordingState>>,
) -> Result<(), String> {
    let mut state = state
        .lock()
        .map_err(|_| "Audio recording state is unavailable".to_string())?;
    if state.active.is_some() {
        return Err("Another native audio recording is already active".to_string());
    }

    let (commands, command_receiver) = mpsc::channel();
    let (ready_sender, ready_receiver) = mpsc::sync_channel(1);
    std::thread::Builder::new()
        .name("keiai-audio-recording".to_string())
        .spawn(move || recording_thread(events, command_receiver, ready_sender))
        .map_err(|error| format!("Could not start the audio recording thread: {error}"))?;

    ready_receiver
        .recv()
        .map_err(|_| "The audio recording thread stopped unexpectedly".to_string())??;
    state.active = Some(ActiveRecording {
        id: recording_id,
        commands,
    });
    Ok(())
}

#[tauri::command]
pub fn finish_audio_recording(
    recording_id: String,
    state: State<'_, Mutex<RecordingState>>,
) -> Result<Response, String> {
    let recording = take_recording(&recording_id, &state)?;
    let (result_sender, result_receiver) = mpsc::sync_channel(1);
    recording
        .commands
        .send(RecordingCommand::Finish(result_sender))
        .map_err(|_| "The audio recording thread stopped unexpectedly".to_string())?;
    let bytes = result_receiver
        .recv()
        .map_err(|_| "The audio recording result was unavailable".to_string())??;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub fn cancel_audio_recording(
    recording_id: String,
    state: State<'_, Mutex<RecordingState>>,
) -> Result<(), String> {
    let recording = take_recording(&recording_id, &state)?;
    let (cancelled_sender, cancelled_receiver) = mpsc::sync_channel(1);
    recording
        .commands
        .send(RecordingCommand::Cancel(cancelled_sender))
        .map_err(|_| "The audio recording thread stopped unexpectedly".to_string())?;
    cancelled_receiver
        .recv()
        .map_err(|_| "The audio recording thread stopped unexpectedly".to_string())
}

fn take_recording(
    recording_id: &str,
    state: &State<'_, Mutex<RecordingState>>,
) -> Result<ActiveRecording, String> {
    let mut state = state
        .lock()
        .map_err(|_| "Audio recording state is unavailable".to_string())?;
    match state.active.as_ref() {
        Some(recording) if recording.id == recording_id => {}
        Some(_) => return Err("A different native audio recording is active".to_string()),
        None => return Err("No native audio recording is active".to_string()),
    }
    state
        .active
        .take()
        .ok_or_else(|| "No native audio recording is active".to_string())
}

fn recording_thread(
    events: Channel<RecordingEvent>,
    commands: mpsc::Receiver<RecordingCommand>,
    ready: mpsc::SyncSender<Result<(), String>>,
) {
    let result = create_input_stream(events);
    let (stream, samples, sample_rate, failure) = match result {
        Ok(recording) => recording,
        Err(error) => {
            let _ = ready.send(Err(error));
            return;
        }
    };
    if let Err(error) = stream.play() {
        let _ = ready.send(Err(format!("Could not start microphone capture: {error}")));
        return;
    }
    if ready.send(Ok(())).is_err() {
        return;
    }

    match commands.recv() {
        Ok(RecordingCommand::Finish(result)) => {
            drop(stream);
            let _ = result.send(finalize_recording(samples, sample_rate, failure));
        }
        Ok(RecordingCommand::Cancel(cancelled)) => {
            drop(stream);
            let _ = cancelled.send(());
        }
        Err(_) => drop(stream),
    }
}

type InputStream = (
    Stream,
    Arc<Mutex<Vec<i16>>>,
    u32,
    Arc<Mutex<Option<String>>>,
);

fn create_input_stream(events: Channel<RecordingEvent>) -> Result<InputStream, String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "No microphone input device is available".to_string())?;
    let supported_config = device
        .default_input_config()
        .map_err(|error| format!("Could not read the microphone configuration: {error}"))?;
    let sample_format = supported_config.sample_format();
    let config: StreamConfig = supported_config.into();
    let sample_rate = config.sample_rate.0;
    let channels = usize::from(config.channels);
    if channels == 0 {
        return Err("The microphone reported no audio channels".to_string());
    }

    let samples = Arc::new(Mutex::new(Vec::new()));
    let failure = Arc::new(Mutex::new(None));
    let stream = match sample_format {
        SampleFormat::F32 => build_input_stream(
            &device,
            &config,
            channels,
            Arc::clone(&samples),
            Arc::clone(&failure),
            events,
            |sample: f32| float_to_i16(sample),
        ),
        SampleFormat::I16 => build_input_stream(
            &device,
            &config,
            channels,
            Arc::clone(&samples),
            Arc::clone(&failure),
            events,
            |sample: i16| sample,
        ),
        SampleFormat::U16 => build_input_stream(
            &device,
            &config,
            channels,
            Arc::clone(&samples),
            Arc::clone(&failure),
            events,
            |sample: u16| (i32::from(sample) - 32_768) as i16,
        ),
        format => Err(format!("Unsupported microphone sample format: {format}")),
    }?;
    Ok((stream, samples, sample_rate, failure))
}

fn finalize_recording(
    samples: Arc<Mutex<Vec<i16>>>,
    sample_rate: u32,
    failure: Arc<Mutex<Option<String>>>,
) -> Result<Vec<u8>, String> {
    if let Some(error) = failure
        .lock()
        .map_err(|_| "Audio recording failure state is unavailable".to_string())?
        .take()
    {
        return Err(error);
    }
    let samples = std::mem::take(
        &mut *samples
            .lock()
            .map_err(|_| "Recorded audio is unavailable".to_string())?,
    );
    if samples.is_empty() {
        return Err("The microphone recording contained no audio".to_string());
    }
    Ok(encode_pcm_wav(&samples, sample_rate))
}

fn build_input_stream<T, Convert>(
    device: &cpal::Device,
    config: &StreamConfig,
    channels: usize,
    samples: Arc<Mutex<Vec<i16>>>,
    failure: Arc<Mutex<Option<String>>>,
    events: Channel<RecordingEvent>,
    convert: Convert,
) -> Result<Stream, String>
where
    T: cpal::SizedSample,
    Convert: Fn(T) -> i16 + Send + Sync + 'static,
{
    let error_events = events.clone();
    let callback_failure = Arc::clone(&failure);
    let mut last_level_at = Instant::now()
        .checked_sub(LEVEL_INTERVAL)
        .unwrap_or_else(Instant::now);
    device
        .build_input_stream(
            config,
            move |input: &[T], _| {
                let mut mono = Vec::with_capacity(input.len() / channels + 1);
                for frame in input.chunks(channels) {
                    let sum = frame
                        .iter()
                        .map(|sample| i64::from(convert(*sample)))
                        .sum::<i64>();
                    mono.push((sum / frame.len() as i64) as i16);
                }
                if mono.is_empty() {
                    return;
                }

                if last_level_at.elapsed() >= LEVEL_INTERVAL {
                    let mean_square = mono
                        .iter()
                        .map(|sample| {
                            let normalized = f64::from(*sample) / f64::from(i16::MAX);
                            normalized * normalized
                        })
                        .sum::<f64>()
                        / mono.len() as f64;
                    let level = (mean_square.sqrt() * 3.0).clamp(0.0, 1.0) as f32;
                    let _ = events.send(RecordingEvent::Level { level });
                    last_level_at = Instant::now();
                }

                if let Ok(mut recorded) = samples.lock() {
                    recorded.extend(mono);
                }
            },
            move |error| {
                let message = format!("Microphone capture failed: {error}");
                if let Ok(mut current) = callback_failure.lock() {
                    *current = Some(message.clone());
                }
                let _ = error_events.send(RecordingEvent::Error { message });
            },
            None,
        )
        .map_err(|error| format!("Could not open the microphone input stream: {error}"))
}

fn float_to_i16(sample: f32) -> i16 {
    (sample.clamp(-1.0, 1.0) * f32::from(i16::MAX)).round() as i16
}

fn encode_pcm_wav(samples: &[i16], sample_rate: u32) -> Vec<u8> {
    let data_size = samples.len().saturating_mul(2).min(u32::MAX as usize) as u32;
    let mut output = Vec::with_capacity(44 + data_size as usize);
    output.extend_from_slice(b"RIFF");
    output.extend_from_slice(&(36u32.saturating_add(data_size)).to_le_bytes());
    output.extend_from_slice(b"WAVEfmt ");
    output.extend_from_slice(&16u32.to_le_bytes());
    output.extend_from_slice(&1u16.to_le_bytes());
    output.extend_from_slice(&1u16.to_le_bytes());
    output.extend_from_slice(&sample_rate.to_le_bytes());
    output.extend_from_slice(&sample_rate.saturating_mul(2).to_le_bytes());
    output.extend_from_slice(&2u16.to_le_bytes());
    output.extend_from_slice(&16u16.to_le_bytes());
    output.extend_from_slice(b"data");
    output.extend_from_slice(&data_size.to_le_bytes());
    for sample in samples.iter().take((data_size / 2) as usize) {
        output.extend_from_slice(&sample.to_le_bytes());
    }
    output
}

#[cfg(test)]
mod tests {
    use super::encode_pcm_wav;

    #[test]
    fn encodes_mono_pcm_wav() {
        let wav = encode_pcm_wav(&[0, i16::MAX, i16::MIN], 48_000);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(u16::from_le_bytes([wav[22], wav[23]]), 1);
        assert_eq!(
            u32::from_le_bytes([wav[24], wav[25], wav[26], wav[27]]),
            48_000
        );
        assert_eq!(u32::from_le_bytes([wav[40], wav[41], wav[42], wav[43]]), 6);
        assert_eq!(wav.len(), 50);
    }
}
