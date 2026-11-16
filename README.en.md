# SXC-1 Web Editor

**[简体中文](README.md) · English**

An unofficial browser-based sample manager for the CASIO SXC-1. It communicates directly with the sampler over USB and Web MIDI, without changing the firmware or installing the official app.

**Upstream hosted editor: [Open the sample manager](https://assong.github.io/SXC1WebEditer/)**

## Getting started

1. Open the HTTPS editor in Chrome or Edge on a computer.
2. Turn on the SXC-1 normally and connect its **DATA** port with a USB data cable.
3. Quit the official app and any other editor connected to the sampler.
4. Click **Connect SXC-1** and allow the browser to access MIDI / SysEx.

Use the language selector in the header or an open dialog to switch between **English** and **简体中文**. Your choice is saved in this browser. Without a saved choice, a Chinese browser language selects Simplified Chinese; other languages select English. Switching languages updates the interface immediately without reloading or reconnecting the sampler. Sample names, filenames, paths, and device data are preserved.

The upstream author reports physical testing with **macOS + Chrome + SXC-1 firmware 1.4.1**. Other operating systems, browsers, and firmware versions have not been physically verified by that report. Connecting requires Web MIDI / SysEx support. The English localization has not been tested on physical hardware; batch uploads have simulated-device and browser coverage only.

## Choose an action

| What you want to do | Action |
| --- | --- |
| Add new sounds to empty pads | **Import audio** → one WAV, or audio files/folder |
| Save the current bank on your computer | **Back up samples → This bank · ZIP** |
| Save every populated bank | **Back up samples → All banks · folder…** |
| Browse a saved backup containing one or many banks | **Open backup…**; extract ZIP backups first |

Audio imports convert files and use default pad settings. Backups preserve original files and settings. Opening a backup browses it on your computer; restoring a saved backup to the sampler is not implemented.

## Features

- Browse samples across 80 banks. Changing the page in the editor also changes the bank on the sampler.
- Pad 1 is at the bottom left. From top to bottom, the rows are **13–16 / 9–12 / 5–8 / 1–4**.
- The Loop switch at the top right of a pad controls looping in browser preview, including during playback. It does not change the sampler's Loop setting.
- Preview samples, download an individual original WAV, or download the current bank as a ZIP containing audio, pad settings, and a verification manifest. Patterns are not included.
- Back up all 80 banks to a folder on your computer, omitting empty banks and pads without audio.
- Select a WAV or drop it onto an empty pad. The editor converts the audio and generates the waveform needed by the sampler's display.
- Select multiple audio files or drop a folder for sequential uploads from a chosen bank/pad. Files are sorted by path and filename. If there is insufficient empty space, the list remains available for retry after resolving the conflict.
- Copy a pad to an empty pad in the same or another bank, retaining the original audio, waveform, start/end points, settings, and associated files.
- Edit Level, Pitch, Group, LED Color, Pan, One Shot, Loop, and BPM, then read the settings back to verify the save.
- Open a local backup folder to browse, preview, and download offline.

Single-WAV uploads support mono or stereo files up to 60 seconds and 64 MB: PCM 8/16/24/32-bit or Float 32-bit, at 8–192 kHz. Audio is converted to **48 kHz / 16-bit stereo**. Upload and paste operations require an empty pad; a pad containing audio or a settings file cannot be overwritten. Normal uploads use default settings; copying preserves the source pad's settings.

Level ranges from 0–100%. Pitch ranges over ±24 semitones and changes playback speed too. Browser preview plays the original WAV and does not emulate the sampler's playback parameters. Start/end points can be preserved and copied, but cannot currently be edited. Bank changes made on the physical sampler do not update the browser automatically. Keep the connection active during writes and avoid operating the sampler at the same time. If a result needs verification, reconnect and check the destination pad.

## Import audio

Use **Import audio → One WAV…** to preview one WAV and choose an empty pad. Choose **Import audio → Audio files or folder…** to select one or more audio files, select a folder, or drop files/folders into the dialog. Subfolders are read recursively; hidden and non-audio files are skipped. Files are ordered numerically by path and filename, and the list previews each destination.

Choose a starting bank (1–80) and pad (1–16). Pad 16 is followed by pad 1 in the next bank. Occupied positions are not skipped, and the range does not wrap to bank 1. Before writing, the editor checks the entire consecutive destination range, validates every audio file, and checks the destinations again. An out-of-range destination, an existing audio/settings file, or any invalid audio file prevents that attempt from starting writes. Resolve the problem and click **Retry upload** without selecting the files again. Before any writes have started, you can also change the starting position or remove problem files.

Each file is limited to 60 seconds and 64 MB, mono or stereo. WAV uses the existing conversion path. MP3, FLAC, M4A, and other formats depend on browser decoding support; unsupported files produce an error. All audio is converted to 48 kHz / 16-bit stereo with the sampler's waveform data and default pad settings. Batch audio import does not restore `.wav.db` settings from a backup.

Uploads run one at a time with read-back verification. **Stop** waits for the current pad's verification to finish. Retry skips completed items and first checks any pad whose result was uncertain when the previous attempt was interrupted. Completed writes are not rolled back. Closing the dialog preserves its list and progress; refreshing or leaving the page clears them. You can download the import record. **Batch upload has passed simulated-device and browser tests; physical batch-write testing remains pending.**

## Back up all banks

Connect the sampler, then choose **Back up samples → All banks · folder…** and choose a destination folder. Choose **This bank · ZIP** in the same menu to download only the current bank. The editor scans all 80 banks and creates a new `SXC-1_AllBanks_…` subfolder only if it finds audio to save. The destination must support folder access in Chrome or Edge.

A pad is included when it has an exact `01.wav`–`16.wav` filename with non-empty WAV audio data. Its associated files, including `.wav.db` settings, are kept with the original audio bytes and filenames. A silent recording still contains audio and is preserved. Missing samples, zero-length files, valid WAVs with no audio data, settings-only pads and their unused sidecars are omitted. Banks with no retained audio get no output folder. Bank numbers and pad numbers are preserved rather than compacted.

Files are saved and checked individually, so the whole device is not collected in memory or constrained by the single-bank ZIP size limit. The existing USB reader still limits each file to 256 MB. The export reads bank directories and files without switching banks or writing to the sampler. It compares directory names and sizes to detect changes; avoid editing or recording on the sampler during the export, since this cannot guarantee an atomic snapshot of changing content.

Each completed backup contains `manifest.json` and `SHA256SUMS.txt`, with only non-empty banks listed. Choose the generated subfolder with **Open backup…** to browse it offline. Patterns and global settings are outside this sample-bank backup's scope. Restore to the device is not implemented by this export feature.

**Cancel** stops the export. Previously saved files remain in the new subfolder with an incomplete manifest where possible; an incomplete backup must not be treated as a finished archive. Retrying creates another new subfolder. An all-empty scan creates no backup. The new all-bank export has simulated-device/filesystem and browser coverage; physical export testing remains pending.

## Files and privacy

Audio conversion, preview, backup reading, and USB communication run locally in the browser. The editor does not upload samples or device backups to a website server. The browser retains the most recent upload and edit records locally. Closing the page clears temporary audio caches and the copy clipboard. The language preference is stored locally as `sxc-language`. GitHub Pages hosts the page files.

This repository publishes the editor and source code only. It does not include device samples, communication captures, firmware, or official app installers.

## Local use and development

The root `index.html` is a single-file page with no external frontend dependencies. To run it locally from the repository directory:

```sh
python3 -m http.server 8764 --bind 127.0.0.1
```

Open `http://localhost:8764/`. The hosted version uses HTTPS.

After changing `src/`, rebuild the page:

```sh
python3 -B src/build.py --output index.html
```

Offline tests:

```sh
node src/test-batch.cjs
node src/test-i18n.cjs
node --test src/test-backup.cjs
```

The localization tests use a minimal fake document and blocked device/network APIs. They do not connect to a sampler. See [source documentation](src/README.md) for localization details.

To review the interface without a device, switch languages, open **Import audio → Audio files or folder…**, select a few audio files and change the starting bank/pad. Switching languages inside the dialog should retain the queue, filenames and selected destinations. Reload to check the saved language preference. A physical upload is a separate test: preserve a backup, choose an empty pad and begin with one short sample before trying a whole bank.

The upstream GitHub Pages deployment serves the root of its `main` branch. Updated sources and the generated `index.html` must be published there before source changes appear on that hosted site. Keep `.nojekyll` in the repository root. A fork's deployment is separate from the upstream site.

## Research reference

Protocol research references [neuvecom/casio_sxc-1_lab](https://github.com/neuvecom/casio_sxc-1_lab). This is an unofficial project with no affiliation to CASIO.
