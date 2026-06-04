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

struct ipc_event {
    u64 timestamp;
    u32 source_pid;
    u32 target_pid;
    u32 fd;
    u32 len;
    u8 msg[MAX_MSG_SIZE];
    char comm[TASK_COMM_LEN];
    u32 event_type;
    u64 dropped_count;
};

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 8 * 1024 * 1024);
} events SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1024);
    __type(key, u32);
    __type(value, u32);
} monitored_pids SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_ARRAY);
    __uint(max_entries, CTRL_MAX);
    __type(key, u32);
    __type(value, u64);
} ipc_control SEC(".maps");

static __always_inline int is_monitored(u32 pid) {
    return bpf_map_lookup_elem(&monitored_pids, &pid) != NULL;
}

static __always_inline int check_backpressure(void) {
    u32 key = CTRL_BACKPRESSURE_ACTIVE;
    u64 *active = bpf_map_lookup_elem(&ipc_control, &key);
    if (active && *active) {
        return 1;
    }
    return 0;
}

static __always_inline void handle_overflow(void) {
    u32 key;
    u64 *val;
    u64 now = bpf_ktime_get_ns();

    key = CTRL_DROPPED_TOTAL;
    val = bpf_map_lookup_elem(&ipc_control, &key);
    if (val) {
        __sync_fetch_and_add(val, 1);
    }

    key = CTRL_LAST_DROP_TS;
    val = bpf_map_lookup_elem(&ipc_control, &key);
    u64 last_ts = val ? *val : 0;

    if (now - last_ts > BACKPRESSURE_THRESHOLD_NS) {
        u64 new_ts = now;
        bpf_map_update_elem(&ipc_control, &key, &new_ts, BPF_ANY);

        struct ipc_event *overflow_event = bpf_ringbuf_reserve(&events, sizeof(*overflow_event), 0);
        if (overflow_event) {
            overflow_event->timestamp = now;
            overflow_event->source_pid = 0;
            overflow_event->target_pid = 0;
            overflow_event->fd = 0;
            overflow_event->len = 0;
            overflow_event->event_type = EVENT_TYPE_OVERFLOW;
            key = CTRL_DROPPED_TOTAL;
            val = bpf_map_lookup_elem(&ipc_control, &key);
            overflow_event->dropped_count = val ? *val : 0;
            __builtin_memset(overflow_event->msg, 0, MAX_MSG_SIZE);
            __builtin_memset(overflow_event->comm, 0, TASK_COMM_LEN);
            bpf_ringbuf_submit(overflow_event, 0);
        }
    }

    key = CTRL_BACKPRESSURE_ACTIVE;
    u64 active_val = 1;
    bpf_map_update_elem(&ipc_control, &key, &active_val, BPF_ANY);
}

static __always_inline void reset_backpressure_if_needed(void) {
    u32 key = CTRL_DROPPED_TOTAL;
    u64 *dropped = bpf_map_lookup_elem(&ipc_control, &key);
    if (dropped && *dropped == 0) {
        key = CTRL_BACKPRESSURE_ACTIVE;
        u64 active_val = 0;
        bpf_map_update_elem(&ipc_control, &key, &active_val, BPF_ANY);
    }
}

SEC("kprobe/unix_stream_sendmsg")
int trace_unix_sendmsg(struct pt_regs *ctx) {
    struct socket *sock = (struct socket *)PT_REGS_PARM1(ctx);
    struct msghdr *msg = (struct msghdr *)PT_REGS_PARM2(ctx);
    u32 pid = bpf_get_current_pid_tgid() >> 32;

    if (!is_monitored(pid))
        return 0;

    if (check_backpressure()) {
        handle_overflow();
        return 0;
    }

    struct ipc_event *event = bpf_ringbuf_reserve(&events, sizeof(*event), 0);
    if (!event) {
        handle_overflow();
        return 0;
    }

    event->timestamp = bpf_ktime_get_ns();
    event->source_pid = pid;
    event->target_pid = 0;
    event->fd = 0;
    event->len = 0;
    event->event_type = EVENT_TYPE_NORMAL;
    event->dropped_count = 0;

    bpf_get_current_comm(&event->comm, sizeof(event->comm));

    struct iov_iter iter;
    bpf_probe_read_kernel(&iter, sizeof(iter), &msg->msg_iter);
    size_t msg_len = iter.count;
    if (msg_len > MAX_MSG_SIZE)
        msg_len = MAX_MSG_SIZE;

    event->len = msg_len;

    bpf_ringbuf_submit(event, 0);
    reset_backpressure_if_needed();
    return 0;
}

SEC("kprobe/unix_stream_recvmsg")
int trace_unix_recvmsg(struct pt_regs *ctx) {
    struct socket *sock = (struct socket *)PT_REGS_PARM1(ctx);
    struct msghdr *msg = (struct msghdr *)PT_REGS_PARM2(ctx);
    u32 pid = bpf_get_current_pid_tgid() >> 32;

    if (!is_monitored(pid))
        return 0;

    if (check_backpressure()) {
        handle_overflow();
        return 0;
    }

    struct ipc_event *event = bpf_ringbuf_reserve(&events, sizeof(*event), 0);
    if (!event) {
        handle_overflow();
        return 0;
    }

    event->timestamp = bpf_ktime_get_ns();
    event->source_pid = pid;
    event->target_pid = 0;
    event->fd = 0;
    event->len = 0;
    event->event_type = EVENT_TYPE_NORMAL;
    event->dropped_count = 0;

    bpf_get_current_comm(&event->comm, sizeof(event->comm));

    bpf_ringbuf_submit(event, 0);
    reset_backpressure_if_needed();
    return 0;
}

char LICENSE[] SEC("license") = "GPL";
