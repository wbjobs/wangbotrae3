let midiEvents = [];
let comments = [];
let isPlaying = false;
let isPaused = false;
let currentTime = 0;
let startTime = 0;
let pauseTime = 0;
let eventIndex = 0;
let commentIndex = 0;
let playbackRate = 1.0;
let timerId = null;

function processEvents() {
    if (!isPlaying || isPaused) return;
    
    const elapsed = (Date.now() - startTime) * playbackRate + pauseTime;
    currentTime = elapsed;
    
    while (eventIndex < midiEvents.length && midiEvents[eventIndex].relativeTime <= elapsed) {
        const event = midiEvents[eventIndex];
        self.postMessage({
            type: 'midi-event',
            event: event,
            currentTime: elapsed
        });
        eventIndex++;
    }
    
    while (commentIndex < comments.length && comments[commentIndex].relativeTime <= elapsed) {
        const comment = comments[commentIndex];
        self.postMessage({
            type: 'comment',
            comment: comment,
            currentTime: elapsed
        });
        commentIndex++;
    }
    
    self.postMessage({
        type: 'time-update',
        currentTime: elapsed,
        eventIndex: eventIndex,
        commentIndex: commentIndex
    });
    
    if (eventIndex >= midiEvents.length && commentIndex >= comments.length) {
        self.postMessage({
            type: 'playback-complete',
            currentTime: elapsed
        });
        isPlaying = false;
        return;
    }
    
    timerId = setTimeout(processEvents, 10);
}

self.onmessage = function(e) {
    const { type, data } = e.data;
    
    switch (type) {
        case 'init':
            midiEvents = data.midiEvents || [];
            comments = data.comments || [];
            const minTime = midiEvents.length > 0 ? Math.min(...midiEvents.map(e => e.timestamp)) : 0;
            
            midiEvents = midiEvents.map(e => ({
                ...e,
                relativeTime: e.timestamp - minTime
            })).sort((a, b) => a.relativeTime - b.relativeTime);
            
            comments = comments.map(c => ({
                ...c,
                relativeTime: (c.timestamp || 0) - minTime
            })).sort((a, b) => a.relativeTime - b.relativeTime);
            
            self.postMessage({
                type: 'ready',
                totalTime: midiEvents.length > 0 ? Math.max(...midiEvents.map(e => e.relativeTime)) : 0,
                eventCount: midiEvents.length,
                commentCount: comments.length
            });
            break;
            
        case 'play':
            if (!isPlaying) {
                isPlaying = true;
                isPaused = false;
                startTime = Date.now();
                pauseTime = 0;
                eventIndex = 0;
                commentIndex = 0;
                processEvents();
                self.postMessage({ type: 'playing' });
            } else if (isPaused) {
                isPaused = false;
                startTime = Date.now();
                processEvents();
                self.postMessage({ type: 'resumed' });
            }
            break;
            
        case 'pause':
            if (isPlaying && !isPaused) {
                isPaused = true;
                pauseTime += (Date.now() - startTime) * playbackRate;
                if (timerId) {
                    clearTimeout(timerId);
                }
                self.postMessage({
                    type: 'paused',
                    currentTime: pauseTime
                });
            }
            break;
            
        case 'stop':
            isPlaying = false;
            isPaused = false;
            currentTime = 0;
            pauseTime = 0;
            eventIndex = 0;
            commentIndex = 0;
            if (timerId) {
                clearTimeout(timerId);
            }
            self.postMessage({ type: 'stopped' });
            break;
            
        case 'seek':
            const seekTime = data.time;
            pauseTime = seekTime;
            if (isPlaying) {
                startTime = Date.now();
            }
            
            eventIndex = 0;
            while (eventIndex < midiEvents.length && midiEvents[eventIndex].relativeTime < seekTime) {
                eventIndex++;
            }
            
            commentIndex = 0;
            while (commentIndex < comments.length && comments[commentIndex].relativeTime < seekTime) {
                commentIndex++;
            }
            
            self.postMessage({
                type: 'seeked',
                currentTime: seekTime,
                eventIndex: eventIndex,
                commentIndex: commentIndex
            });
            break;
            
        case 'set-rate':
            if (isPlaying && !isPaused) {
                pauseTime += (Date.now() - startTime) * playbackRate;
                startTime = Date.now();
            }
            playbackRate = data.rate;
            self.postMessage({
                type: 'rate-changed',
                rate: playbackRate
            });
            break;
    }
};
