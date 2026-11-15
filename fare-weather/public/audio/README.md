# Recordings go here

Drop audio files into `sfx/`, `music/` and `voice/` using the names in `ELEVENLABS.md` at the top of the project, for example:

```
sfx/door_open.m4a
music/rainy_window.m4a
voice/car/welcome_1.m4a
voice/maya/hello.m4a
```

`.m4a`, `.mp3`, `.wav` and `.ogg` all work. The game uses a recording wherever one exists and its built-in stand-in everywhere else, so this folder can be filled a few files at a time.

The files here now were built from raw takes by `npm run audio` (see the project README). If you replace one of them by hand, remove its entry in `src/audio/recordings.json`, which holds the extra gain and the line timings measured for the file it describes.
