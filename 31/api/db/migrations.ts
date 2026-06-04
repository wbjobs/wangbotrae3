export const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS videos (id TEXT PRIMARY KEY, fileName TEXT NOT NULL, duration REAL NOT NULL, fileSize INTEGER NOT NULL, filePath TEXT NOT NULL, createdAt TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS subtitles (id TEXT PRIMARY KEY, videoId TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE, fileName TEXT NOT NULL, format TEXT NOT NULL CHECK(format IN ('srt', 'ass')), totalLines INTEGER NOT NULL, filePath TEXT NOT NULL, createdAt TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS align_tasks (id TEXT PRIMARY KEY, videoId TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE, subtitleId TEXT NOT NULL REFERENCES subtitles(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'processing' CHECK(status IN ('processing', 'completed', 'failed')), threshold INTEGER NOT NULL DEFAULT 200, progress INTEGER NOT NULL DEFAULT 0, totalCues INTEGER NOT NULL DEFAULT 0, correctedCues INTEGER NOT NULL DEFAULT 0, averageOffset REAL NOT NULL DEFAULT 0, score REAL NOT NULL DEFAULT 0, createdAt TEXT NOT NULL DEFAULT (datetime('now')), completedAt TEXT);
CREATE TABLE IF NOT EXISTS aligned_cues (id INTEGER PRIMARY KEY AUTOINCREMENT, taskId TEXT NOT NULL REFERENCES align_tasks(id) ON DELETE CASCADE, cueIndex INTEGER NOT NULL, originalStart INTEGER NOT NULL, originalEnd INTEGER NOT NULL, alignedStart INTEGER NOT NULL, alignedEnd INTEGER NOT NULL, offset INTEGER NOT NULL, text TEXT NOT NULL, corrected INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_subtitles_videoId ON subtitles(videoId);
CREATE INDEX IF NOT EXISTS idx_align_tasks_videoId ON align_tasks(videoId);
CREATE INDEX IF NOT EXISTS idx_align_tasks_subtitleId ON align_tasks(subtitleId);
CREATE INDEX IF NOT EXISTS idx_align_tasks_status ON align_tasks(status);
CREATE INDEX IF NOT EXISTS idx_aligned_cues_taskId ON aligned_cues(taskId);
`
