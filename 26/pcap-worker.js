const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const { PluginManager } = require('./plugin-manager');

const PCAP_MAGIC = 0xa1b2c3d4;
const PCAP_MAGIC_SWAPPED = 0xd4c3b2a1;
const PCAPNG_MAGIC = 0x0a0d0d0a;

const ETHERTYPE_IP = 0x0800;
const ETHERTYPE_IPV6 = 0x86dd;
const IP_PROTO_TCP = 6;
const IP_PROTO_UDP = 17;

const PROGRESS_INTERVAL_PACKETS = 5000;

const pluginManager = new PluginManager();
pluginManager.loadBuiltinPlugins();

function readUInt32BE(buf, offset) { return buf.readUInt32BE(offset); }
function readUInt32LE(buf, offset) { return buf.readUInt32LE(offset); }

function parsePcapHeader(buf) {
  if (buf.length < 24) return null;
  const magic = buf.readUInt32BE(0);
  let readU32, readU16, bigEndian;
  if (magic === PCAP_MAGIC) {
    bigEndian = true;
    readU32 = readUInt32BE;
    readU16 = (b, o) => b.readUInt16BE(o);
  } else if (magic === PCAP_MAGIC_SWAPPED) {
    bigEndian = false;
    readU32 = readUInt32LE;
    readU16 = (b, o) => b.readUInt16LE(o);
  } else {
    return null;
  }
  return { magicNumber: magic, majorVersion: readU16(buf, 4), minorVersion: readU16(buf, 6),
    gmtOffset: readU32(buf, 8), timestampAccuracy: readU32(buf, 12),
    snapshotLength: readU32(buf, 16), linkLayerType: readU32(buf, 20),
    bigEndian, readU32, readU16 };
}

function* parsePcapPacketsGenerator(buf, header, fileSize) {
  const { readU32 } = header;
  let offset = 24;
  let packetCount = 0;
  let lastProgress = 0;

  while (offset + 16 <= buf.length) {
    const tsSec = readU32(buf, offset);
    const tsUsec = readU32(buf, offset + 4);
    const inclLen = readU32(buf, offset + 8);
    const origLen = readU32(buf, offset + 12);
    offset += 16;
    if (offset + inclLen > buf.length) break;
    const data = buf.slice(offset, offset + inclLen);
    yield {
      timestamp: tsSec + tsUsec / 1000000,
      capturedLength: inclLen,
      originalLength: origLen,
      data
    };
    offset += inclLen;
    packetCount++;

    if (packetCount - lastProgress >= PROGRESS_INTERVAL_PACKETS) {
      lastProgress = packetCount;
      parentPort.postMessage({
        type: 'progress',
        packetCount,
        bytesProcessed: offset,
        totalBytes: fileSize
      });
    }
  }
}

function* parsePcapngPacketsGenerator(buf, fileSize) {
  const interfaces = [];
  let readU32 = readUInt32LE;
  let readU16 = (b, o) => b.readUInt16LE(o);
  let offset = 0;
  let packetCount = 0;
  let lastProgress = 0;

  while (offset + 12 <= buf.length) {
    const blockType = buf.readUInt32LE(offset);
    const blockLen = buf.readUInt32LE(offset + 4);

    if (blockType === 0x0a0d0d0a) {
      const bom = buf.readUInt32LE(offset + 8);
      if (bom === 0x1a2b3c4d) {
        readU32 = readUInt32LE;
        readU16 = (b, o) => b.readUInt16LE(o);
      } else if (bom === 0x4d3c2b1a) {
        readU32 = readUInt32BE;
        readU16 = (b, o) => b.readUInt16BE(o);
      }
    }

    if (blockLen < 12 || offset + blockLen > buf.length) break;

    if (blockType === 0x00000001) {
      const linkType = readU16(buf, offset + 8);
      const tsResol = buf.length > offset + 20 ? buf[offset + 20] : 6;
      const tsUnit = tsResol === 6 ? 1e-6 : tsResol === 9 ? 1e-9 : Math.pow(10, -tsResol);
      interfaces.push({ linkType, tsUnit });
    } else if (blockType === 0x00000006) {
      const ifaceId = readU32(buf, offset + 8);
      const tsHigh = readU32(buf, offset + 12);
      const tsLow = readU32(buf, offset + 16);
      const capLen = readU32(buf, offset + 20);
      const origLen = readU32(buf, offset + 24);
      const dataOffset = offset + 28;
      if (dataOffset + capLen <= buf.length) {
        const data = buf.slice(dataOffset, dataOffset + capLen);
        const tsUnit = (interfaces[ifaceId] && interfaces[ifaceId].tsUnit) || 1e-6;
        yield {
          timestamp: (tsHigh * 4294967296 + tsLow) * tsUnit,
          capturedLength: capLen,
          originalLength: origLen,
          data,
          linkType: (interfaces[ifaceId] && interfaces[ifaceId].linkType) || 1
        };
        packetCount++;
        if (packetCount - lastProgress >= PROGRESS_INTERVAL_PACKETS) {
          lastProgress = packetCount;
          parentPort.postMessage({
            type: 'progress', packetCount, bytesProcessed: offset, totalBytes: fileSize
          });
        }
      }
    } else if (blockType === 0x00000003) {
      const origLen = readU32(buf, offset + 8);
      const dataOffset = offset + 12;
      const capLen = blockLen - 12 - 4;
      if (dataOffset + capLen <= buf.length && capLen > 0) {
        const data = buf.slice(dataOffset, dataOffset + capLen);
        const linkType = interfaces.length > 0 ? interfaces[0].linkType : 1;
        yield {
          timestamp: 0, capturedLength: capLen, originalLength: origLen,
          data, linkType
        };
        packetCount++;
      }
    }

    offset += blockLen;
  }
}

function parseIPv4(buf, offset) {
  if (offset + 20 > buf.length) return null;
  const version = (buf[offset] >> 4) & 0xf;
  if (version !== 4) return null;
  const ihl = (buf[offset] & 0xf) * 4;
  const totalLength = buf.readUInt16BE(offset + 2);
  const protocol = buf[offset + 9];
  const srcIp = `${buf[offset + 12]}.${buf[offset + 13]}.${buf[offset + 14]}.${buf[offset + 15]}`;
  const dstIp = `${buf[offset + 16]}.${buf[offset + 17]}.${buf[offset + 18]}.${buf[offset + 19]}`;

  let srcPort = 0, dstPort = 0, tcpFlags = null, payloadOffset = offset + ihl, payloadLength = 0;
  let tcpSeq = 0, tcpAck = 0, tcpWin = 0;

  if (protocol === IP_PROTO_TCP && offset + ihl + 14 <= buf.length) {
    srcPort = buf.readUInt16BE(offset + ihl);
    dstPort = buf.readUInt16BE(offset + ihl + 2);
    tcpSeq = buf.readUInt32BE(offset + ihl + 4);
    tcpAck = buf.readUInt32BE(offset + ihl + 8);
    const dataOffset = ((buf[offset + ihl + 12] >> 4) & 0xf) * 4;
    tcpFlags = {
      fin: !!(buf[offset + ihl + 13] & 0x01),
      syn: !!(buf[offset + ihl + 13] & 0x02),
      rst: !!(buf[offset + ihl + 13] & 0x04),
      psh: !!(buf[offset + ihl + 13] & 0x08),
      ack: !!(buf[offset + ihl + 13] & 0x10),
      urg: !!(buf[offset + ihl + 13] & 0x20),
      ece: !!(buf[offset + ihl + 13] & 0x40),
      cwr: !!(buf[offset + ihl + 13] & 0x80)
    };
    tcpWin = buf.readUInt16BE(offset + ihl + 14);
    payloadOffset = offset + ihl + dataOffset;
    payloadLength = totalLength - ihl - dataOffset;
  } else if (protocol === IP_PROTO_UDP && offset + ihl + 8 <= buf.length) {
    srcPort = buf.readUInt16BE(offset + ihl);
    dstPort = buf.readUInt16BE(offset + ihl + 2);
    const udpLen = buf.readUInt16BE(offset + ihl + 4);
    payloadOffset = offset + ihl + 8;
    payloadLength = udpLen - 8;
  }

  return {
    version: 4, ihl, totalLength, protocol,
    protocolName: protocol === IP_PROTO_TCP ? 'TCP' : protocol === IP_PROTO_UDP ? 'UDP' : `IP_PROTO_${protocol}`,
    srcIp, dstIp, srcPort, dstPort, tcpFlags, payloadOffset, payloadLength,
    tcpSeq, tcpAck, tcpWin, headerOffset: offset
  };
}

function parseIPv6(buf, offset) {
  if (offset + 40 > buf.length) return null;
  const version = (buf[offset] >> 4) & 0xf;
  if (version !== 6) return null;
  const payloadLen = buf.readUInt16BE(offset + 4);
  const nextHeader = buf[offset + 6];

  const srcIp = Array.from({ length: 8 }, (_, i) =>
    buf.readUInt16BE(offset + 8 + i * 2).toString(16)).join(':');
  const dstIp = Array.from({ length: 8 }, (_, i) =>
    buf.readUInt16BE(offset + 24 + i * 2).toString(16)).join(':');

  let srcPort = 0, dstPort = 0, tcpFlags = null;
  let transportOffset = offset + 40;
  let protocol = nextHeader;
  let tcpSeq = 0, tcpAck = 0;

  const extHeaders = [0, 43, 44, 50, 51, 60];
  let maxChain = 10;
  while (extHeaders.includes(protocol) && maxChain-- > 0) {
    if (transportOffset + 8 > buf.length) break;
    protocol = buf[transportOffset];
    const extLen = (buf[transportOffset + 1] + 1) * 8;
    transportOffset += extLen;
  }

  if (protocol === IP_PROTO_TCP && transportOffset + 14 <= buf.length) {
    srcPort = buf.readUInt16BE(transportOffset);
    dstPort = buf.readUInt16BE(transportOffset + 2);
    tcpSeq = buf.readUInt32BE(transportOffset + 4);
    tcpAck = buf.readUInt32BE(transportOffset + 8);
    const dataOffset = ((buf[transportOffset + 12] >> 4) & 0xf) * 4;
    tcpFlags = {
      fin: !!(buf[transportOffset + 13] & 0x01),
      syn: !!(buf[transportOffset + 13] & 0x02),
      rst: !!(buf[transportOffset + 13] & 0x04),
      psh: !!(buf[transportOffset + 13] & 0x08),
      ack: !!(buf[transportOffset + 13] & 0x10),
      urg: !!(buf[transportOffset + 13] & 0x20),
      ece: !!(buf[transportOffset + 13] & 0x40),
      cwr: !!(buf[transportOffset + 13] & 0x80)
    };
  } else if (protocol === IP_PROTO_UDP && transportOffset + 8 <= buf.length) {
    srcPort = buf.readUInt16BE(transportOffset);
    dstPort = buf.readUInt16BE(transportOffset + 2);
  }

  return {
    version: 6, protocol,
    protocolName: protocol === IP_PROTO_TCP ? 'TCP' : protocol === IP_PROTO_UDP ? 'UDP' : `IP_PROTO_${protocol}`,
    srcIp, dstIp, srcPort, dstPort, tcpFlags,
    payloadOffset: transportOffset, payloadLength: payloadLen,
    tcpSeq, tcpAck, headerOffset: offset
  };
}

function parseEthernetPacket(data, linkType) {
  let ipOffset = 0;
  if (linkType === 1) {
    if (data.length < 14) return null;
    const etherType = data.readUInt16BE(12);
    ipOffset = 14;
    if (etherType === 0x8100) {
      if (data.length < 18) return null;
      ipOffset = 18;
      const innerType = data.readUInt16BE(16);
      if (innerType !== ETHERTYPE_IP && innerType !== ETHERTYPE_IPV6) return null;
    } else if (etherType !== ETHERTYPE_IP && etherType !== ETHERTYPE_IPV6) {
      return null;
    }
  } else if (linkType === 101) {
    ipOffset = 0;
  } else if (linkType === 113) {
    if (data.length < 16) return null;
    ipOffset = 16;
  } else if (linkType === 276) {
    if (data.length < 10) return null;
    ipOffset = 10;
  } else if (linkType === 108) {
    ipOffset = 4;
  } else {
    return null;
  }
  if (ipOffset >= data.length) return null;
  const ipVersion = (data[ipOffset] >> 4) & 0xf;
  if (ipVersion === 4) return parseIPv4(data, ipOffset);
  if (ipVersion === 6) return parseIPv6(data, ipOffset);
  return null;
}

function getFlowKey(parsed) {
  if (!parsed) return null;
  const { srcIp, dstIp, srcPort, dstPort, protocol } = parsed;
  if (srcPort === 0 && dstPort === 0) return null;
  const key1 = `${srcIp}:${srcPort}-${dstIp}:${dstPort}-${protocol}`;
  const key2 = `${dstIp}:${dstPort}-${srcIp}:${srcPort}-${protocol}`;
  return key1 < key2 ? key1 : key2;
}

class TCPFlowTracker {
  constructor() {
    this.clients = new Map();
    this.seenPackets = new Set();
  }

  checkAndMark(parsed, pkt, dir) {
    if (parsed.protocol !== IP_PROTO_TCP) return { isDup: false, isReorder: false };

    const key = dir === 0
      ? `${parsed.srcIp}:${parsed.srcPort}`
      : `${parsed.dstIp}:${parsed.dstPort}`;

    let state = this.clients.get(key);
    if (!state) {
      state = { nextSeq: -1, maxAck: 0 };
      this.clients.set(key, state);
    }

    const seq = parsed.tcpSeq;
    const ack = parsed.tcpAck;
    const payloadLen = Math.max(0, parsed.payloadLength);
    const flags = parsed.tcpFlags;

    let isDup = false;
    let isReorder = false;

    const pktId = `${seq}-${ack}-${payloadLen}-${flags.syn}-${flags.fin}-${flags.rst}`;
    if (this.seenPackets.has(pktId)) {
      isDup = true;
    }
    this.seenPackets.add(pktId);

    if (state.nextSeq !== -1) {
      if (seq < state.nextSeq && payloadLen > 0) {
        isDup = true;
      } else if (seq > state.nextSeq) {
        isReorder = true;
      }
    }

    const increment = payloadLen + (flags.syn ? 1 : 0) + (flags.fin ? 1 : 0);
    if (increment > 0) {
      const nextExpected = seq + increment;
      if (nextExpected > state.nextSeq) {
        state.nextSeq = nextExpected;
      }
    }
    if (ack > state.maxAck) {
      state.maxAck = ack;
    }

    return { isDup, isReorder };
  }
}

class StatisticsCollector {
  constructor(startTime) {
    this.startTime = startTime;
    this.protocolCounts = new Map();
    this.protocolBytes = new Map();
    this.trafficPerMinute = new Map();
    this.tcpFlags = { syn: 0, synAck: 0, fin: 0, rst: 0, ack: 0, psh: 0, urg: 0 };
    this.tcpTotalPackets = 0;
    this.tcpDupPackets = 0;
    this.tcpReorderPackets = 0;
    this.udpTotalPackets = 0;
    this.totalBytes = 0;
    this.ipv4Count = 0;
    this.ipv6Count = 0;
    this.topTalkers = new Map();
    this.firstTimestamp = null;
    this.lastTimestamp = null;
  }

  recordPacket(pktInfo, parsed, rawPacket) {
    if (this.firstTimestamp === null || pktInfo.timestamp < this.firstTimestamp) {
      this.firstTimestamp = pktInfo.timestamp;
    }
    if (this.lastTimestamp === null || pktInfo.timestamp > this.lastTimestamp) {
      this.lastTimestamp = pktInfo.timestamp;
    }

    const proto = parsed.protocolName;
    this.protocolCounts.set(proto, (this.protocolCounts.get(proto) || 0) + 1);
    this.protocolBytes.set(proto, (this.protocolBytes.get(proto) || 0) + pktInfo.originalLength);
    this.totalBytes += pktInfo.originalLength;

    if (parsed.version === 4) this.ipv4Count++;
    if (parsed.version === 6) this.ipv6Count++;

    const talkerKey = parsed.srcIp < parsed.dstIp
      ? `${parsed.srcIp}-${parsed.dstIp}`
      : `${parsed.dstIp}-${parsed.srcIp}`;
    this.topTalkers.set(talkerKey, (this.topTalkers.get(talkerKey) || 0) + pktInfo.originalLength);

    const minuteBucket = Math.floor(pktInfo.timestamp / 60) * 60;
    const curr = this.trafficPerMinute.get(minuteBucket) || { bytes: 0, packets: 0 };
    curr.bytes += pktInfo.originalLength;
    curr.packets += 1;
    this.trafficPerMinute.set(minuteBucket, curr);

    if (parsed.protocol === IP_PROTO_TCP) {
      this.tcpTotalPackets++;
      const flags = parsed.tcpFlags;
      if (flags) {
        if (flags.syn && !flags.ack) this.tcpFlags.syn++;
        if (flags.syn && flags.ack) this.tcpFlags.synAck++;
        if (flags.fin) this.tcpFlags.fin++;
        if (flags.rst) this.tcpFlags.rst++;
        if (flags.ack) this.tcpFlags.ack++;
        if (flags.psh) this.tcpFlags.psh++;
        if (flags.urg) this.tcpFlags.urg++;
      }
      if (pktInfo.isDup) this.tcpDupPackets++;
      if (pktInfo.isReorder) this.tcpReorderPackets++;
    } else if (parsed.protocol === IP_PROTO_UDP) {
      this.udpTotalPackets++;
    }
  }

  getStatistics() {
    const protocolDistribution = [];
    for (const [name, count] of this.protocolCounts) {
      protocolDistribution.push({
        protocol: name,
        count,
        bytes: this.protocolBytes.get(name) || 0,
        percentage: this.totalBytes > 0
          ? ((this.protocolBytes.get(name) || 0) / this.totalBytes * 100).toFixed(2)
          : 0
      });
    }
    protocolDistribution.sort((a, b) => b.bytes - a.bytes);

    const trafficTimeline = [];
    const times = Array.from(this.trafficPerMinute.keys()).sort();
    const minTime = times.length > 0 ? times[0] : 0;
    for (const t of times) {
      const data = this.trafficPerMinute.get(t);
      trafficTimeline.push({
        timestamp: t,
        relativeTime: (t - (this.firstTimestamp || 0)).toFixed(0),
        bytes: data.bytes,
        packets: data.packets,
        kbps: data.bytes * 8 / 60 / 1000
      });
    }

    const retransmissionRate = this.tcpTotalPackets > 0
      ? (this.tcpDupPackets / this.tcpTotalPackets * 100).toFixed(3)
      : 0;

    const talkers = Array.from(this.topTalkers.entries())
      .map(([pair, bytes]) => {
        const [a, b] = pair.split('-');
        return { src: a, dst: b, bytes };
      })
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 10);

    return {
      totalPackets: this.protocolCounts.size > 0
        ? Array.from(this.protocolCounts.values()).reduce((a, b) => a + b, 0)
        : 0,
      totalBytes: this.totalBytes,
      duration: this.firstTimestamp !== null && this.lastTimestamp !== null
        ? this.lastTimestamp - this.firstTimestamp
        : 0,
      startTime: this.firstTimestamp,
      endTime: this.lastTimestamp,
      ipv4Count: this.ipv4Count,
      ipv6Count: this.ipv6Count,
      protocolDistribution,
      trafficTimeline,
      tcpFlags: this.tcpFlags,
      tcpStats: {
        totalPackets: this.tcpTotalPackets,
        dupPackets: this.tcpDupPackets,
        reorderPackets: this.tcpReorderPackets,
        retransmissionRate: parseFloat(retransmissionRate)
      },
      udpStats: {
        totalPackets: this.udpTotalPackets
      },
      topTalkers: talkers
    };
  }
}

function parseFile(filePath) {
  const buf = fs.readFileSync(filePath);
  const fileSize = buf.length;

  if (buf.length < 4) {
    throw new Error('File too small to be a valid capture file');
  }

  const first4 = buf.readUInt32BE(0);
  let packetGen;
  let linkType = 1;

  if (first4 === PCAP_MAGIC || first4 === PCAP_MAGIC_SWAPPED) {
    const header = parsePcapHeader(buf);
    if (!header) throw new Error('Invalid pcap header');
    linkType = header.linkLayerType;
    packetGen = parsePcapPacketsGenerator(buf, header, fileSize);
  } else if (first4 === PCAPNG_MAGIC || first4 === 0x0a0d0d0a) {
    packetGen = parsePcapngPacketsGenerator(buf, fileSize);
  } else {
    throw new Error('Unrecognized file format. Expected pcap or pcapng.');
  }

  const flows = {};
  const tcpTrackers = new Map();
  const allParsedPackets = [];
  let totalPackets = 0;
  let lastProgressSend = 0;
  let statsCollector = null;

  for (const pkt of packetGen) {
    totalPackets++;

    const lt = pkt.linkType || linkType;
    const parsed = parseEthernetPacket(pkt.data, lt);
    if (!parsed) continue;
    if (parsed.protocol !== IP_PROTO_TCP && parsed.protocol !== IP_PROTO_UDP) continue;

    if (statsCollector === null) {
      statsCollector = new StatisticsCollector(pkt.timestamp);
    }

    const flowKey = getFlowKey(parsed);
    if (!flowKey) continue;

    const hexPreview = pkt.data.slice(0, 64).toString('hex');
    const packetInfo = {
      timestamp: pkt.timestamp,
      capturedLength: pkt.capturedLength,
      originalLength: pkt.originalLength,
      srcIp: parsed.srcIp,
      dstIp: parsed.dstIp,
      srcPort: parsed.srcPort,
      dstPort: parsed.dstPort,
      protocol: parsed.protocolName,
      protocolNum: parsed.protocol,
      tcpFlags: parsed.tcpFlags,
      payloadLength: Math.max(0, parsed.payloadLength),
      hexPreview,
      totalLength: parsed.totalLength || pkt.originalLength,
      direction: 0,
      tcpSeq: parsed.tcpSeq,
      tcpAck: parsed.tcpAck,
      isDup: false,
      isReorder: false,
      appLayerData: null
    };

    if (!flows[flowKey]) {
      flows[flowKey] = {
        key: flowKey,
        srcIp: parsed.srcIp,
        dstIp: parsed.dstIp,
        srcPort: parsed.srcPort,
        dstPort: parsed.dstPort,
        protocol: parsed.protocolName,
        protocolNum: parsed.protocol,
        packets: [],
        startTime: pkt.timestamp,
        endTime: pkt.timestamp
      };
      if (parsed.protocol === IP_PROTO_TCP) {
        tcpTrackers.set(flowKey, new TCPFlowTracker());
      }
    }

    const flow = flows[flowKey];
    if (parsed.srcIp === flow.srcIp && parsed.srcPort === flow.srcPort) {
      packetInfo.direction = 0;
    } else {
      packetInfo.direction = 1;
    }

    if (parsed.protocol === IP_PROTO_TCP) {
      const tracker = tcpTrackers.get(flowKey);
      if (tracker) {
        const tcpState = tracker.checkAndMark(parsed, pkt, packetInfo.direction);
        packetInfo.isDup = tcpState.isDup;
        packetInfo.isReorder = tcpState.isReorder;
      }
    }

    statsCollector.recordPacket(packetInfo, parsed, pkt.data);

    if (parsed.payloadLength > 0 && parsed.payloadOffset > 0) {
      const payload = pkt.data.slice(parsed.payloadOffset, parsed.payloadOffset + parsed.payloadLength);
      const appData = pluginManager.runPlugins(packetInfo, payload, pkt.data);
      if (appData) {
        packetInfo.appLayerData = appData;
      }
    }

    flow.packets.push(packetInfo);
    if (pkt.timestamp < flow.startTime) flow.startTime = pkt.timestamp;
    if (pkt.timestamp > flow.endTime) flow.endTime = pkt.timestamp;

    allParsedPackets.push(packetInfo);
  }

  for (const key of Object.keys(flows)) {
    const flow = flows[key];
    if (flow.protocol === 'TCP') {
      flow.packets.sort((a, b) => {
        if (a.direction !== b.direction) {
          return a.direction - b.direction;
        }
        if (a.tcpSeq !== undefined && b.tcpSeq !== undefined) {
          return a.tcpSeq - b.tcpSeq;
        }
        return a.timestamp - b.timestamp;
      });
    }
  }

  const flowList = Object.values(flows).map(f => ({
    key: f.key,
    srcIp: f.srcIp,
    dstIp: f.dstIp,
    srcPort: f.srcPort,
    dstPort: f.dstPort,
    protocol: f.protocol,
    protocolNum: f.protocolNum,
    packetCount: f.packets.length,
    startTime: f.startTime,
    endTime: f.endTime,
    duration: f.endTime - f.startTime,
    packets: f.packets
  }));

  flowList.sort((a, b) => a.startTime - b.startTime);

  parentPort.postMessage({
    type: 'progress',
    packetCount: totalPackets,
    bytesProcessed: fileSize,
    totalBytes: fileSize,
    done: true
  });

  return {
    totalPackets: allParsedPackets.length,
    flowCount: flowList.length,
    flows: flowList,
    statistics: statsCollector ? statsCollector.getStatistics() : null
  };
}

try {
  const result = parseFile(workerData.filePath);
  parentPort.postMessage({ type: 'complete', result });
} catch (error) {
  parentPort.postMessage({ type: 'error', error: error.message });
}
