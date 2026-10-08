# Pilots Quest: almost autonomous Reel production

## Purpose

Turn one aviation exam topic into a complete, catchy 9:16 Reel: verified teaching point, short script, consistent characters, reference images, song, audio analysis, lyric-matched choreography, Seedance/Kling clips, readable overlays, cover, and final edit.

Claude acts as the production coordinator and uses its connected OpenArt MCP tools where available. This document is a workflow, not confirmation that any particular tool, model version, or audio feature is available. Discover capabilities in the connected session before using them.

## What our previous work establishes

- We develop aviation lessons with an immediate hook, comedy, a concise explanation, and a save/follow ending.
- We design a storyboard, preserve recurring characters and costumes, and write separate prompts for images, Suno, and video.
- For the ATC Reel, the curly-haired student is on the viewer's left. The bearded instructor is on the viewer's right, wearing the extravagant gold-covered captain costume.
- Both remain seated. The instructor performs the rap with meaningful hand gestures. The student reacts to the beat, including brief arm raises.
- The earlier choreography followed written lyrics. The earlier assistant explicitly could not reliably play the uploaded song, so its timing was not verified against the recording.
- We made headline overlays and a cover. The image-generated overlays were recreations, with styling differences; they were not exact extractions from the storyboard.
- Claude/OpenArt operation is the production route requested by the user. The available chat history does not independently verify previous OpenArt jobs or MCP calls.

## 1. Set up one production folder

Create a new folder for each Reel, outside the read-only `sources/` folder. Never edit, rename, move, or delete synced project sources.

```text
reels/<topic>/
  brief.md
  sources-and-claims.md
  character-bible.md
  script-and-lyrics.md
  prompts/
    images.md
    suno.md
    seedance.md
    kling.md
  references/
  audio/
  timing.csv
  choreography.md
  jobs.json
  clips/
  overlays/
  edit/
  deliverables/
  review.md
  state.json
```

Keep selected assets, rejected candidates, and revisions distinguishable. Save downloads locally when permitted; do not rely only on temporary links. Do not overwrite a selected asset silently.

## 2. Establish the brief and permission scope

Read the topic, audience, references, prior decisions, and project instructions. Fill missing low-impact creative choices with reasonable defaults.

Record:

- Topic and one main learning outcome.
- Exam context or jurisdiction, when relevant.
- Target length and vertical 9:16 format.
- Characters, setting, tone, and active singer.
- Chosen song, if already supplied and identified as final.
- Tools/accounts available and permitted output location.
- Authorized generation budget or credit ceiling, if paid jobs are to be submitted.
- Whether final export and publication are authorized.

Drafting, inspecting, organizing, and preparing prompts can proceed autonomously. Do not start spending unspecified credits, buying subscriptions, or publishing publicly. If a limit is missing, prepare the production package first and ask only for the missing decision.

## 3. Discover Claude's OpenArt MCP capabilities

In Claude, inspect the connected tool names, descriptions, required arguments, and available model choices. Confirm which actions actually exist:

1. Image generation or editing, and reference-image input.
2. Seedance and Kling generation, if exposed.
3. Supported duration, aspect ratio, resolution, and reference controls.
4. Audio upload, audio-conditioned animation, lip-sync, or video-to-video support, if exposed.
5. Job submission, status retrieval, result inspection, and download/export.
6. Credit estimates or balance inspection, if exposed.

Save the capability check in `brief.md`. Use exact tool schemas from the session. Do not invent endpoint names, model versions, job IDs, or unsupported parameters.

If MCP cannot perform a required action, complete all independent work and report the exact missing action. Use another available tool or browser route only within the user's authorized scope and platform access rules. Never report a submitted job as completed before retrieving its result.

## 4. Verify the aviation lesson before writing the song

Read the relevant uploaded books first. Record the book, edition when available, printed page, PDF page, and supporting passage for each claim. An incomplete `.crdownload` file is not a reliable source unless its contents can actually be read and verified.

Check current official aviation sources when the subject concerns regulations, operational phraseology, jurisdiction-specific rules, or a claim that the books do not settle. Prefer the applicable authority's publications.

Create a claim table:

| Claim | Source and page/section | Applicability | Wording allowed in Reel |
|---|---|---|---|
| Proposed teaching point | Verified reference | Aircraft/jurisdiction/context | Short accurate statement |

Separate a memory aid from an official procedure. Do not turn a rhyme into a universal operational rule. Do not claim an item comes from an official exam bank without evidence.

For the ATC example, verify any use of “call sign first” in its specific context; initial calls and readbacks should not be reduced to an unqualified universal slogan. Revise misleading wording before generating audio.

## 5. Write a concise hook, explanation, and ending

Use one teaching point per Reel. Put the hook in the first visual beat. Prefer a clear question, relatable mistake, or visual joke.

ATC example structure:

1. “YOU CAN FLY THE PLANE…”
2. “…BUT CAN YOU TALK TO ATC?”
3. Student freezes: “BRAIN: OFFLINE.”
4. Instructor intervenes: “STOP IMPROVISING! HERE'S THE FIX.”
5. Short musical explanation.
6. “SAVE THIS BEFORE YOUR NEXT FLIGHT!”

These are story beats, not fixed audio timestamps. Let the selected song determine the musical section's final duration. Keep captions short enough to read at the actual playback speed.

## 6. Lock the characters and visual design

Save a character bible with reference images and a simple continuity checklist.

For the current ATC setup:

- **Student, viewer's left:** young curly-haired man, aviator sunglasses, green headset, white pilot shirt, black tie, black/gold epaulettes; nervous but enthusiastic.
- **Instructor, viewer's right:** bearded man, aviator sunglasses, green headset, ornate white/gold captain hat and extravagant gold-covered uniform; confident and funny.
- **Performance:** both seated; fixed camera for the song; instructor sings unless the selected recording requires a different assignment.

Use selected reference images as the authority for costume details. Do not introduce leopard print, medals, extra accessories, or different hats unless they are present in the selected reference or deliberately requested.

Define “left” and “right” as viewer positions so generations do not swap characters. Keep faces, seats, headsets, lighting, cockpit layout, and costume accessories consistent.

Prefer a parked cockpit for hands-up comedy. If the setting is flight, establish who retains aircraft control during gestures; do not show both pilots abandoning the controls together as normal flying behavior.

## 7. Generate and inspect reference images

Write a separate copyable image prompt for each scene. Include character references, positions, expression, setting, composition, 9:16 framing, and continuity constraints.

Generate a clean reference frame for the musical performance. Keep text overlays separate so the video model does not distort them.

Inspect the actual images for face consistency, costumes, headset placement, hands, cockpit geometry, and framing. Select the strongest usable image. Repair a specific defect with a targeted revision rather than changing the whole design.

Create the cover from the selected character references with one readable hook, such as “CAN YOU TALK TO ATC?” Check it at phone-thumbnail size and in the intended feed crop.

## 8. Write lyrics and a separate Suno prompt

Write short lyrics that preserve the verified teaching point. Give each line one clear idea and one obvious gesture. Avoid padding that adds ambiguity just to achieve a rhyme.

Save lyrics and the Suno style prompt separately. Specify genre, energy, vocal character, language, approximate duration, and a fast entrance. Do not assume a requested duration guarantees the generated song's duration.

Prepare a small candidate set within the authorized budget. If no song-generation tool is connected, deliver the copyable Suno package and continue with independent visual work.

Before timing the performance, ask the user to supply or explicitly select the **final song**. If they have already identified a file as final, reuse that decision. Do not repeatedly ask for approval of the same recording.

## 9. Listen, analyze, and re-listen to the final song

Use the actual final audio file. Verify it opens, identify its duration, and record its filename/version. Never derive exact vocal timing from the lyric draft alone.

Perform these passes:

1. **Whole-song review:** confirm the lyrics actually sung, pronunciation, clarity, energy, intro/outro, and any extra words.
2. **Lyric alignment:** mark the start and end of every sung line; mark key words that drive gestures.
3. **Beat review:** locate strong musical accents, pauses, transitions, and the final hit. Do not assume constant tempo.
4. **Singer review:** identify the active voice in each section. If a voice assignment is ambiguous, record uncertainty instead of inventing it.
5. **Second review:** check each timing mark against the recording, especially the starts of words and clip boundaries.

Use transcription, waveform inspection, and alignment tools as aids. Audition the recording and resulting clips with an available audio/video review tool; tool-generated timing can be wrong. If actual listening is unavailable, state that limitation and mark the timing unverified. Do not claim to have listened.

Write `timing.csv`:

```csv
line_id,start_seconds,end_seconds,actual_lyric,active_singer,keyword_seconds,beat_notes,verified
```

Populate it only from the selected recording. If the audio changes, invalidate downstream timing and choreography for affected sections.

## 10. Build choreography from the measured audio

Create one row per lyric or short phrase:

| Audio interval | Actual lyric | Active singer | Instructor gesture | Student reaction | Camera | Overlay |
|---|---|---|---|---|---|---|
| Measured from final audio | Verbatim sung words | Identified character | Gesture on keyword | Reaction on beat | Fixed/framing cue | Matching short caption |

For the ATC performance, useful gesture mappings include:

- “Listen”: instructor taps headset; student nods.
- “Think”: instructor taps temple.
- “Press”: instructor indicates push-to-talk, when supported by the lyric/context.
- “Say again”: instructor cups ear or makes a small repeat gesture.
- “Never guess”: instructor wags one finger; student shakes head.
- “Short and clear”: two concise hand chops.
- “Save”: instructor points toward the viewer.

Only use a mapping when that phrase is actually in the selected song. Keep the instructor's mouth active during his vocal lines and the student's mouth relaxed when he is not singing. Use brief, physically plausible upper-body movements with time to return to neutral.

The earlier eight-line rap is a reference for intent, not proof of the final recording's words or timing.

## 11. Split the performance into manageable clips

Use the duration choices supported by the connected video model. Start with roughly 4–6 second sections when supported, but select boundaries around complete phrases and gestures rather than cutting mechanically every five seconds.

Record both the full-song interval and local clip timing. Include short edit handles if supported and useful. Avoid splitting a syllable, cutting a gesture halfway through, or creating an impossible pose jump.

For every clip save:

- Selected reference image and, if supported, start/end frame.
- Song version, exact excerpt, and full-song offset.
- Local lyric and gesture timing.
- Active singer and non-singer behavior.
- Required first and last pose.
- Intended duration, crop, and resolution.

## 12. Prepare separate Seedance and Kling prompts

Do not reuse a long whole-song prompt unchanged for every shot. Adapt each prompt to the actual controls supported by that model through OpenArt.

Use this common structure, then save separate model-specific versions:

```text
OUTPUT: vertical 9:16; one continuous shot; [supported duration].
REFERENCES: [selected character/cockpit image identifiers].
CHARACTERS: student on viewer's left; instructor on viewer's right.
CONTINUITY: preserve faces, costumes, seats, headsets, lighting and cockpit.
AUDIO: [final song version and supported audio input/excerpt].
VOCAL ASSIGNMENT: [who sings each local interval]; other character does not lip-sync.
LOCAL TIMELINE:
[verified local interval] — [actual lyric] — [keyword gesture] — [beat reaction].
CAMERA: [fixed framing or explicitly planned movement].
START/END: [poses that connect to adjacent clips].
CONSTRAINTS: seated throughout; no seat swaps, extra people, costume changes,
invented dialogue, generated subtitles or uncontrolled aircraft movement.
```

Writing “lip-sync” in a prompt does not create audio conditioning. If the connected model cannot use audio or provide suitable lip-sync, generate the visual performance and use a supported lip-sync stage afterward. If no such stage exists, report that limitation before calling the result synchronized.

## 13. Generate a representative test, then the remaining clips

Choose a short section containing a clear vocal line, gesture, and student reaction. Test the supported Seedance and Kling paths within the agreed credit limit when comparison is authorized.

Evaluate the returned videos rather than selecting a model by reputation. Choose the route that best preserves identity, movement, timing, and image quality. Record the choice and reason.

Submit the remaining clips through Claude's actual OpenArt MCP tools. Save each submission's job ID immediately with its model, prompt, references, duration, and estimated cost when available.

Track `jobs.json` and `state.json`. Reuse valid completed jobs after interruptions. If submission times out, inspect job status before retrying so duplicate paid jobs are not created. Poll at a sensible interval; download only when the job reports completion and results are accessible.

Default quality policy: one initial generation per clip, followed by up to two targeted repairs when needed and within budget. Stop repeated spending on a defect the available tools cannot solve.

## 14. Watch generated videos before revising

Inspect the full clip, review useful frames, and compare playback with the final song. Never revise an uploaded/generated video based only on its prompt or filename.

Check:

- Correct singer and mouth activity.
- Gesture on the intended word and reactions on the intended beat.
- Stable faces, costumes, seating, and cockpit.
- Hands, headset microphones, accessories, and plausible motion.
- Consistent start/end poses between clips.
- No added speech, unexpected text, or unwanted camera movement.

Log the defect, where it occurs, and a focused repair instruction in `review.md`. Preserve already successful clips. If a prompt repair cannot solve lip-sync, use an available dedicated stage rather than submitting the same failed instruction repeatedly.

## 15. Make overlays accurately

Keep typography outside the video generation stage. Use readable caption sizing, contrast, and margins; preview at phone size and against the actual moving background.

For an **exact extraction**, preserve the source image pixels and isolate them with a mask in an image editor. Retain intentional brush backplates, outlines, shadows, and attached icons. Inspect edges over light and dark backgrounds and verify a real alpha channel. Do not use generative recreation and label it exact.

For a **new design**, generation or editable typography is appropriate. Label a recreation honestly. Never silently substitute it for an exact extraction request.

If literal preservation is impossible because pixels are obscured or the source is too small, explain the specific limitation. Do not invent the missing detail and call it unchanged.

## 16. Assemble and re-listen to the finished Reel

Use the selected final song as the master audio track. Align clips to the measured full-song timeline. Trim edit handles without shifting the intended vocal/gesture alignment.

Add the hook, selected performance clips, overlays, ending, and cover. Avoid double audio or an unintended model-generated soundtrack. Keep captions away from faces and expected platform interface areas.

Review the complete Reel twice:

1. With sound: lyric correctness, pronunciation, singer assignment, sync, transitions, pacing, and audio level.
2. Muted and at phone size: immediate hook, readable captions, coherent teaching point, continuity, and cover legibility.

Export a vertical MP4 in the editor's supported, platform-appropriate format. Check the exported file itself for resolution, audio, duration, and playback. Do not mark an edit ready merely because an export command succeeded.

## 17. Deliver a reviewable package

Provide the final Reel, cover PNG, separate overlays, selected song, and copyable prompt files. Include a short caption and a factual source note when appropriate.

Report what was generated, what was inspected, any remaining defects, and whether audio timing/lip-sync is verified. Link actual files. Distinguish a prompt package, submitted jobs, completed clips, assembled edit, and published Reel.

Keep publication separate unless explicitly authorized. Do not send messages to other people or other chats as part of this workflow without authorization.

## Autonomy rules

Proceed without repeated questions for research, routine creative choices, prompt preparation, local file organization, inspection, and corrections within the approved scope. Batch non-blocking work while waiting for the final song or paid-generation authorization.

Ask only when a decision blocks the next dependent step:

| Missing decision | Continue now | Wait before |
|---|---|---|
| Final song not supplied/selected | Research, script, references, cover | Exact vocal timestamps and timed video generation |
| Unclear aviation jurisdiction that changes the lesson | Visual design and neutral drafts | Final factual wording |
| No generation budget/credit permission | Complete copyable prompts and shot list | Submitting paid jobs |
| Missing tool or unsupported audio control | All independent assets and prompts | Claiming execution or verified synchronization |
| Publication not authorized | Finish and deliver the export | Public upload |

Send brief updates at meaningful milestones. State a blocker precisely; do not repeat unchanged status. Never treat silence as approval.

## Copyable instruction for Claude

```text
Produce a Pilots Quest Reel following PILOTS_QUEST_AUTONOMOUS_REEL_WORKFLOW.md.
Coordinate the work almost autonomously using your available tools and your
connected OpenArt MCP. First inspect its actual capabilities and use only
supported tool arguments. Maintain a production folder, state file, and job log.

Use uploaded aviation books as read-only references and verify technical claims.
Create a concise hook, script, lyrics, character bible, selected reference images,
and separate copyable image, Suno, Seedance, and Kling prompts. Preserve recurring
faces and costumes. Use 9:16 framing and readable captions.

Ask for the final song before assigning exact vocal timestamps unless I have
already explicitly selected it. Then review the actual recording, transcribe the
words sung, measure timing, identify the active singer, and re-check alignment.
Match each gesture to its lyric and each reaction to the beat. Do not claim to
have listened if you cannot audition the audio.

Generate a representative test, inspect it, choose the suitable supported model
route, and produce the remaining clips within my authorized credit budget.
Inspect job status before retrying uncertain submissions. Watch every returned
video before revising it. Repair only the affected clips. Use a supported lip-sync
stage if needed; do not assume a text prompt alone synchronizes singing.

Make overlays separately. Exact extraction must preserve source pixels;
AI recreations must be labeled as recreations. Assemble the Reel to the selected
master audio, review the exported result, and deliver the MP4, cover, overlays,
song, prompts, and a short factual/review report with working file links.

Continue independent work while a blocking decision is pending. Ask only for
missing decisions that change the result, the final song, paid-generation scope,
or public publication permission. Reuse my previous approvals. Do not invent
tool capabilities, results, listening, timestamps, technical facts, or completion.
```
