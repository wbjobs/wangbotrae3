#include <vmlinux.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>
#include <bpf/bpf_core_read.h>

#define MAX_MSG_SIZE 4096
#define TASK_COMM_LEN 16
#define EVENT_TYPE_NORMAL 0
#define EVENT_TYPE_OVERFLOW 1
#define BACKPRESSURE_THRESHOLD_NS 1000000000ULL

enum control_index {
    CTRL_BACKPRESSURE_ACTIVE = 0,
    CTRL_HIGH_WATERMARK_PCT = 1,
    CTRL_LOW_WATERMARK_PCT = 2,
    CTRL_DROPPED_TOTAL = 3,
    CTRL_LAST_DROP_TS = 4,
    CTRL_BUFFER_SIZE = 5,
    CTRL_MAX
};

struct pipe_event {
    u64 timestamp;
    u32 pid;
    u32 fd;
    u32 len;
    u8 data[MAX_MSG_SIZE];
    char comm[TASK_COMM_LEN];
    u8 direction;
    u32 event_type;
    u64 dropped_count;
};

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 8 * 1024 * 1024);
} pipe_events SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1024);
    __type(key, u32);
    __type(value, u32);
} monitored_pids SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 65536);
    __type(key, u64);
    __type(value, u32);
} pipe_inode_to_pid SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_ARRAY);
    __uint(max_entries, CTRL_MAX);
    __type(key, u32);
    __type(value, u64);
} pipe_control SEC(".maps");

static __always_inline int is_monitored(u32 pid) {
    return bpf_map_lookup_elem(&monitored_pids, &pid) != NULL;
}

static __always_inline int check_backpressure_pipe(void) {
    u32 key = CTRL_BACKPRESSURE_ACTIVE;
    u64 *active = bpf_map_lookup_elem(&pipe_control, &key);
    if (active && *active) {
        return 1;
    }
    return 0;
}

static __always_inline void handle_overflow_pipe(void) {
    u32 key;
    u64 *val;
    u64 now = bpf_ktime_get_ns();

    key = CTRL_DROPPED_TOTAL;
    val = bpf_map_lookup_elem(&pipe_control, &key);
    if (val) {
        __sync_fetch_and_add(val, 1);
    }

    key = CTRL_LAST_DROP_TS;
    val = bpf_map_lookup_elem(&pipe_control, &key);
    u64 last_ts = val ? *val : 0;

    if (now - last_ts > BACKPRESSURE_THRESHOLD_NS) {
        u64 new_ts = now;
        bpf_map_update_elem(&pipe_control, &key, &new_ts, BPF_ANY);

        struct pipe_event *overflow_event = bpf_ringbuf_reserve(&pipe_events, sizeof(*overflow_event), 0);
        if (overflow_event) {
            overflow_event->timestamp = now;
            overflow_event->pid = 0;
            overflow_event->fd = 0;
            overflow_event->len = 0;
            overflow_event->direction = 0;
            overflow_event->event_type = EVENT_TYPE_OVERFLOW;
            key = CTRL_DROPPED_TOTAL;
            val = bpf_map_lookup_elem(&pipe_control, &key);
            overflow_event->dropped_count = val ? *val : 0;
            __builtin_memset(overflow_event->data, 0, MAX_MSG_SIZE);
            __builtin_memset(overflow_event->comm, 0, TASK_COMM_LEN);
            bpf_ringbuf_submit(overflow_event, 0);
        }
    }

    key = CTRL_BACKPRESSURE_ACTIVE;
    u64 active_val = 1;
    bpf_map_update_elem(&pipe_control, &key, &active_val, BPF_ANY);
}

static __always_inline void reset_backpressure_pipe_if_needed(void) {
    u32 key = CTRL_DROPPED_TOTAL;
    u64 *dropped = bpf_map_lookup_elem(&pipe_control, &key);
    if (dropped && *dropped == 0) {
        key = CTRL_BACKPRESSURE_ACTIVE;
        u64 active_val = 0;
        bpf_map_update_elem(&pipe_control, &key, &active_val, BPF_ANY);
    }
}

SEC("kprobe/pipe_write")
int trace_pipe_write(struct pt_regs *ctx) {
    struct file *file = (struct file *)PT_REGS_PARM1(ctx);
    const char __user *buf = (const char __user *)PT_REGS_PARM2(ctx);
    size_t count = (size_t)PT_REGS_PARM3(ctx);
    u32 pid = bpf_get_current_pid_tgid() >> 32;

    if (!is_monitored(pid))
        return 0;

    if (check_backpressure_pipe()) {
        handle_overflow_pipe();
        return 0;
    }

    struct pipe_event *event = bpf_ringbuf_reserve(&pipe_events, sizeof(*event), 0);
    if (!event) {
        handle_overflow_pipe();
        return 0;
    }

    event->timestamp = bpf_ktime_get_ns();
    event->pid = pid;
    event->direction = 0;
    event->len = 0;
    event->event_type = EVENT_TYPE_NORMAL;
    event->dropped_count = 0;

    size_t copy_len = count;
    if (copy_len > MAX_MSG_SIZE)
        copy_len = MAX_MSG_SIZE;

    bpf_probe_read_user(event->data, copy_len, buf);
    event->len = copy_len;

    bpf_get_current_comm(&event->comm, sizeof(event->comm));

    struct inode *inode = BPF_CORE_READ(file, f_inode);
    u64 inode_num = BPF_CORE_READ(inode, i_ino);
    bpf_map_update_elem(&pipe_inode_to_pid, &inode_num, &pid, BPF_ANY);

    bpf_ringbuf_submit(event, 0);
    reset_backpressure_pipe_if_needed();
    return 0;
}

SEC("kprobe/pipe_read")
int trace_pipe_read(struct pt_regs *ctx) {
    struct file *file = (struct file *)PT_REGS_PARM1(ctx);
    char __user *buf = (char __user *)PT_REGS_PARM2(ctx);
    size_t count = (size_t)PT_REGS_PARM3(ctx);
    u32 pid = bpf_get_current_pid_tgid() >> 32;

    if (!is_monitored(pid))
        return 0;

    if (check_backpressure_pipe()) {
        handle_overflow_pipe();
        return 0;
    }

    struct pipe_event *event = bpf_ringbuf_reserve(&pipe_events, sizeof(*event), 0);
    if (!event) {
        handle_overflow_pipe();
        return 0;
    }

    event->timestamp = bpf_ktime_get_ns();
    event->pid = pid;
    event->direction = 1;
    event->len = 0;
    event->event_type = EVENT_TYPE_NORMAL;
    event->dropped_count = 0;

    bpf_get_current_comm(&event->comm, sizeof(event->comm));

    struct inode *inode = BPF_CORE_READ(file, f_inode);
    u64 inode_num = BPF_CORE_READ(inode, i_ino);
    u32 *writer_pid = bpf_map_lookup_elem(&pipe_inode_to_pid, &inode_num);
    if (writer_pid)
        event->fd = *writer_pid;

    bpf_ringbuf_submit(event, 0);
    reset_backpressure_pipe_if_needed();
    return 0;
}

char LICENSE[] SEC("license") = "GPL";
