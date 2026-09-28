const fs = require("node:fs");
const os = require("node:os");

// The container shares the VM's kernel, so /proc/stat, /proc/meminfo, /proc/net/dev and /proc/diskstats
// describe the whole VM; /proc/<pid> only lists this container's processes.
const PROC = process.env.HEALTH_PROC_ROOT || "/proc";
const CLOCK_TICKS = 100;
const SECTOR_BYTES = 512;
const VIRTUAL_IFACE = /^(lo|docker\d*|veth|br-|virbr|cni|flannel|tun|tap|wg)/;
const WHOLE_DISK = /^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|hd[a-z]+|nvme\d+n\d+|mmcblk\d+)$/;

const read = (file) => {
    try { return fs.readFileSync(file, "utf8"); } catch { return null; }
};

const parseCpuTimes = (statText) => {
    const line = statText?.split("\n").find((l) => l.startsWith("cpu "));
    if (!line) return null;
    const [user, nice, system, idle, iowait = 0, irq = 0, softirq = 0, steal = 0] = line.trim().split(/\s+/).slice(1).map(Number);
    return { idle: idle + iowait, iowait, steal, total: user + nice + system + idle + iowait + irq + softirq + steal };
};

const cpuPercentages = (prev, next) => {
    if (!prev || !next) return null;
    const total = next.total - prev.total;
    if (total <= 0) return null;
    const pct = (value) => Math.max(0, Math.min(100, (value / total) * 100));
    return { cpu: pct(total - (next.idle - prev.idle)), iowait: pct(next.iowait - prev.iowait), steal: pct(next.steal - prev.steal) };
};

const parseMeminfo = (text) => {
    const values = {};
    for (const line of (text || "").split("\n")) {
        const match = line.match(/^(\w+):\s+(\d+)/);
        if (match) values[match[1]] = Number(match[2]) * 1024;
    }
    const total = values.MemTotal || 0;
    const available = values.MemAvailable ?? values.MemFree ?? 0;
    return {
        memTotal: total,
        memUsed: Math.max(0, total - available),
        swapTotal: values.SwapTotal || 0,
        swapUsed: Math.max(0, (values.SwapTotal || 0) - (values.SwapFree || 0)),
    };
};

const parseNetDev = (text) => {
    const interfaces = {};
    for (const line of (text || "").split("\n").slice(2)) {
        const [name, rest] = line.split(":");
        if (!rest || VIRTUAL_IFACE.test(name.trim())) continue;
        const fields = rest.trim().split(/\s+/).map(Number);
        interfaces[name.trim()] = { rx: fields[0], tx: fields[8] };
    }
    return interfaces;
};

const parseDiskstats = (text) => {
    let readBytes = 0, writeBytes = 0;
    for (const line of (text || "").split("\n")) {
        const fields = line.trim().split(/\s+/);
        if (fields.length < 10 || !WHOLE_DISK.test(fields[2])) continue;
        readBytes += Number(fields[5]) * SECTOR_BYTES;
        writeBytes += Number(fields[9]) * SECTOR_BYTES;
    }
    return { readBytes, writeBytes };
};

const parseDefaultInterface = (routeText) => {
    const line = (routeText || "").split("\n").slice(1).find((l) => l.split(/\s+/)[1] === "00000000");
    return line ? line.split(/\s+/)[0] : null;
};

// Parses /proc/<pid>/stat; the command name is in parentheses and may contain spaces.
const parsePidStat = (text) => {
    const end = text?.lastIndexOf(")");
    if (!text || end < 0) return null;
    const comm = text.slice(text.indexOf("(") + 1, end);
    const fields = text.slice(end + 2).split(" ");
    return { comm, ppid: Number(fields[1]), cpuTicks: Number(fields[11]) + Number(fields[12]) };
};

const parseRss = (statusText) => {
    const match = statusText?.match(/^VmRSS:\s+(\d+)/m);
    return match ? Number(match[1]) * 1024 : 0;
};

const listProcesses = () => {
    let pids;
    try { pids = fs.readdirSync(PROC).filter((name) => /^\d+$/.test(name)); } catch { return []; }
    const list = [];
    for (const pid of pids) {
        const stat = parsePidStat(read(`${PROC}/${pid}/stat`));
        if (stat) list.push({ pid: Number(pid), ...stat, rss: parseRss(read(`${PROC}/${pid}/status`)) });
    }
    return list;
};

// Nexterm's own processes: this Node server and the engine with everything it spawned (RDP/VNC/SSH workers).
const groupProcesses = (processes, serverPid) => {
    const byParent = new Map();
    for (const p of processes) {
        if (!byParent.has(p.ppid)) byParent.set(p.ppid, []);
        byParent.get(p.ppid).push(p);
    }
    const engine = { cpuTicks: 0, rss: 0, processes: 0 };
    const addTree = (p) => {
        engine.cpuTicks += p.cpuTicks;
        engine.rss += p.rss;
        engine.processes++;
        for (const child of byParent.get(p.pid) || []) addTree(child);
    };
    for (const p of processes) if (p.comm === "nexterm-engine") addTree(p);
    const server = processes.find((p) => p.pid === serverPid) || { cpuTicks: 0, rss: 0 };
    return { server: { cpuTicks: server.cpuTicks, rss: server.rss }, engine };
};

const diskUsage = (path) => {
    try {
        const s = fs.statfsSync(path);
        const total = s.blocks * s.bsize;
        return { total, used: total - s.bfree * s.bsize };
    } catch {
        return { total: 0, used: 0 };
    }
};

const readUptime = () => Math.round(Number(read(`${PROC}/uptime`)?.split(" ")[0]) || os.uptime());

const readLinkSpeedMbps = (iface) => {
    const speed = Number(read(`/sys/class/net/${iface}/speed`));
    return Number.isFinite(speed) && speed > 0 ? speed : null;
};

// Raw counters; rates are computed from two consecutive snapshots by the collector.
const snapshot = (dataPath) => {
    const load = (read(`${PROC}/loadavg`) || "").split(" ").map(Number);
    return {
        at: Date.now(),
        cpuTimes: parseCpuTimes(read(`${PROC}/stat`)),
        memory: parseMeminfo(read(`${PROC}/meminfo`)),
        load: { load1: load[0] || 0, load5: load[1] || 0, load15: load[2] || 0 },
        net: parseNetDev(read(`${PROC}/net/dev`)),
        disk: parseDiskstats(read(`${PROC}/diskstats`)),
        processes: groupProcesses(listProcesses(), process.pid),
        rootDisk: diskUsage("/"),
        dataDisk: diskUsage(dataPath),
    };
};

const hostInfo = () => {
    const defaultInterface = parseDefaultInterface(read(`${PROC}/net/route`));
    return {
        cpus: os.cpus().length,
        kernel: os.release(),
        uptime: readUptime(),
        defaultInterface,
        detectedLinkMbps: defaultInterface ? readLinkSpeedMbps(defaultInterface) : null,
    };
};

module.exports = {
    CLOCK_TICKS,
    snapshot,
    hostInfo,
    readUptime,
    cpuPercentages,
    parseCpuTimes,
    parseMeminfo,
    parseNetDev,
    parseDiskstats,
    parseDefaultInterface,
    parsePidStat,
    parseRss,
    groupProcesses,
};
