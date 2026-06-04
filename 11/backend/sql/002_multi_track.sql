CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS rooms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by VARCHAR(100) NOT NULL,
    status VARCHAR(50) DEFAULT 'active',
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE TABLE IF NOT EXISTS audio_tracks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    file_path VARCHAR(512) NOT NULL,
    duration FLOAT NOT NULL DEFAULT 0,
    fingerprint JSONB,
    sample_rate INTEGER DEFAULT 16000,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    track_type VARCHAR(50) NOT NULL,
    source_label VARCHAR(100),
    waveform JSONB
);

CREATE TABLE IF NOT EXISTS sync_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
    reference_audio_id UUID REFERENCES audio_tracks(id) ON DELETE CASCADE,
    recorded_audio_id UUID REFERENCES audio_tracks(id) ON DELETE CASCADE,
    time_offset FLOAT,
    confidence FLOAT,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS offset_matrices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
    recorded_audio_id UUID REFERENCES audio_tracks(id) ON DELETE CASCADE,
    matrix JSONB NOT NULL,
    track_ids JSONB NOT NULL,
    track_labels JSONB NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_rooms_created_at ON rooms(created_at);
CREATE INDEX IF NOT EXISTS idx_audio_tracks_room_id ON audio_tracks(room_id);
CREATE INDEX IF NOT EXISTS idx_audio_tracks_room_type ON audio_tracks(room_id, track_type);
CREATE INDEX IF NOT EXISTS idx_sync_sessions_room_id ON sync_sessions(room_id);
CREATE INDEX IF NOT EXISTS idx_offset_matrices_room_id ON offset_matrices(room_id);
