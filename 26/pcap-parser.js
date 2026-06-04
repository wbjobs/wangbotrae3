const fs = require('fs');

const PCAP_MAGIC = 0xa1b2c3d4;
const PCAP_MAGIC_SWAPPED = 0xd4c3b2a1;
const PCAPNG_MAGIC = 0x0a0d0d0a;

const ETHERTYPE_IP = 0x0800;
const ETHERTYPE_IPV6 = 0x86dd;
const IP_PROTO_TCP = 6;
const IP_PROTO_UDP = 17;

function readUInt32BE(buf, offset) {
  return buf.readUInt32BE(offset);
}

function readUInt32LE(buf, offset) {
  return buf.readUInt32LE(offset);
}

function parsePcapHeader(buf) {
  if (buf.length < 24) return null;
  const magic = buf.readUInt32BE(0);
  let readU32, readU16;
  let bigEndian;
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
  return {
    magicNumber: magic,
    majorVersion: readU16(buf, 4),
    minorVersion: readU16(buf, 6),
    gmtOffset: readU32(buf, 8),
    timestampAccuracy: readU32(buf, 12),
    snapshotLength: readU32(buf, 16),
    linkLayerType: readU32(buf, 20),
    bigEndian,
    readU32,
    readU16
  };
}

function parsePcapPackets(buf, header) {
  const packets = [];
  const { readU32, readU16, bigEndian } = header;
  let offset = 24;
  while (offset + 16 <= buf.length) {
    const tsSec = readU32(buf, offset);
    const tsUsec = readU32(buf, offset + 4);
    const inclLen = readU32(buf, offset + 8);
    const origLen = readU32(buf, offset + 12);
    offset += 16;
    if (offset + inclLen > buf.length) break;
    const data = buf.slice(offset, offset + inclLen);
    packets.push({
      timestamp: tsSec + tsUsec / 1000000,
      capturedLength: inclLen,
      originalLength: origLen,
      data
    });
    offset += inclLen;
  }
  return packets;
}

function parsePcapngFile(buf) {
  const packets = [];
  const interfaces = [];
  let readU32 = readUInt32LE;
  let readU16 = (b, o) => b.readUInt16LE(o);
  let offset = 0;

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
      let tsUnit;
      if (tsResol === 6) {
        tsUnit = 1e-6;
      } else if (tsResol === 9) {
        tsUnit = 1e-9;
      } else {
        tsUnit = Math.pow(10, -tsResol);
      }
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
        const timestamp = (tsHigh * 4294967296 + tsLow) * tsUnit;
        packets.push({
          timestamp,
          capturedLength: capLen,
          originalLength: origLen,
          data,
          linkType: (interfaces[ifaceId] && interfaces[ifaceId].linkType) || 1
        });
      }
    } else if (blockType === 0x00000003) {
      const origLen = readU32(buf, offset + 8);
      const dataOffset = offset + 12;
      const capLen = blockLen - 12 - 4;
      if (dataOffset + capLen <= buf.length && capLen > 0) {
        const data = buf.slice(dataOffset, dataOffset + capLen);
        const linkType = interfaces.length > 0 ? interfaces[0].linkType : 1;
        packets.push({
          timestamp: 0,
          capturedLength: capLen,
          originalLength: origLen,
          data,
          linkType
        });
      }
    }

    offset += blockLen;
  }
  return packets;
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

  if (protocol === IP_PROTO_TCP && offset + ihl + 14 <= buf.length) {
    srcPort = buf.readUInt16BE(offset + ihl);
    dstPort = buf.readUInt16BE(offset + ihl + 2);
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
    version: 4,
    ihl,
    totalLength,
    protocol,
    protocolName: protocol === IP_PROTO_TCP ? 'TCP' : protocol === IP_PROTO_UDP ? 'UDP' : `IP_PROTO_${protocol}`,
    srcIp,
    dstIp,
    srcPort,
    dstPort,
    tcpFlags,
    payloadOffset,
    payloadLength,
    headerOffset: offset,
    ipHeader: buf.slice(offset, offset + ihl)
  };
}

function parseIPv6(buf, offset) {
  if (offset + 40 > buf.length) return null;
  const version = (buf[offset] >> 4) & 0xf;
  if (version !== 6) return null;
  const payloadLen = buf.readUInt16BE(offset + 4);
  const nextHeader = buf[offset + 6];
  const hopLimit = buf[offset + 7];

  const srcIp = Array.from({ length: 8 }, (_, i) =>
    buf.readUInt16BE(offset + 8 + i * 2).toString(16)
  ).join(':');

  const dstIp = Array.from({ length: 8 }, (_, i) =>
    buf.readUInt16BE(offset + 24 + i * 2).toString(16)
  ).join(':');

  let srcPort = 0, dstPort = 0, tcpFlags = null;
  let transportOffset = offset + 40;
  let protocol = nextHeader;

  // Handle extension headers simply
  let extHeaders = [0, 43, 44, 50, 51, 60];
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
    version: 6,
    protocol,
    protocolName: protocol === IP_PROTO_TCP ? 'TCP' : protocol === IP_PROTO_UDP ? 'UDP' : `IP_PROTO_${protocol}`,
    srcIp,
    dstIp,
    srcPort,
    dstPort,
    tcpFlags,
    payloadOffset: transportOffset,
    payloadLength: payloadLen,
    headerOffset: offset
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

  if (ipVersion === 4) {
    return parseIPv4(data, ipOffset);
  } else if (ipVersion === 6) {
    return parseIPv6(data, ipOffset);
  }
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

function parseFile(filePath) {
  const buf = fs.readFileSync(filePath);

  if (buf.length < 4) {
    throw new Error('File too small to be a valid capture file');
  }

  const first4 = buf.readUInt32BE(0);
  let packets;
  let linkType = 1;

  if (first4 === PCAP_MAGIC || first4 === PCAP_MAGIC_SWAPPED) {
    const header = parsePcapHeader(buf);
    if (!header) throw new Error('Invalid pcap header');
    linkType = header.linkLayerType;
    packets = parsePcapPackets(buf, header);
  } else if (first4 === PCAPNG_MAGIC || first4 === 0x0a0d0d0a) {
    packets = parsePcapngFile(buf);
  } else {
    throw new Error('Unrecognized file format. Expected pcap or pcapng.');
  }

  const flows = {};
  const allParsedPackets = [];

  for (const pkt of packets) {
    const lt = pkt.linkType || linkType;
    const parsed = parseEthernetPacket(pkt.data, lt);
    if (!parsed) continue;
    if (parsed.protocol !== IP_PROTO_TCP && parsed.protocol !== IP_PROTO_UDP) continue;

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
      direction: 0
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
    }

    const flow = flows[flowKey];
    if (parsed.srcIp === flow.srcIp && parsed.srcPort === flow.srcPort) {
      packetInfo.direction = 0;
    } else {
      packetInfo.direction = 1;
    }

    flow.packets.push(packetInfo);
    if (pkt.timestamp < flow.startTime) flow.startTime = pkt.timestamp;
    if (pkt.timestamp > flow.endTime) flow.endTime = pkt.timestamp;

    allParsedPackets.push(packetInfo);
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

  return {
    totalPackets: allParsedPackets.length,
    flowCount: flowList.length,
    flows: flowList
  };
}

function filterFlows(data, filters) {
  let flows = data.flows;

  if (filters.ip) {
    const ip = filters.ip;
    flows = flows.filter(f =>
      f.srcIp.includes(ip) || f.dstIp.includes(ip)
    );
  }

  if (filters.port) {
    const port = parseInt(filters.port, 10);
    flows = flows.filter(f =>
      f.srcPort === port || f.dstPort === port
    );
  }

  if (filters.protocol) {
    flows = flows.filter(f =>
      f.protocol.toUpperCase() === filters.protocol.toUpperCase()
    );
  }

  if (filters.minLength || filters.maxLength) {
    flows = flows.map(f => {
      const filtered = { ...f, packets: f.packets.filter(p => {
        const len = p.payloadLength || p.capturedLength;
        if (filters.minLength && len < parseInt(filters.minLength, 10)) return false;
        if (filters.maxLength && len > parseInt(filters.maxLength, 10)) return false;
        return true;
      })};
      filtered.packetCount = filtered.packets.length;
      return filtered;
    }).filter(f => f.packetCount > 0);
  }

  if (filters.timeStart || filters.timeEnd) {
    flows = flows.map(f => {
      const filtered = { ...f, packets: f.packets.filter(p => {
        if (filters.timeStart && p.timestamp < parseFloat(filters.timeStart)) return false;
        if (filters.timeEnd && p.timestamp > parseFloat(filters.timeEnd)) return false;
        return true;
      })};
      filtered.packetCount = filtered.packets.length;
      if (filtered.packets.length > 0) {
        filtered.startTime = filtered.packets[0].timestamp;
        filtered.endTime = filtered.packets[filtered.packets.length - 1].timestamp;
        filtered.duration = filtered.endTime - filtered.startTime;
      }
      return filtered;
    }).filter(f => f.packetCount > 0);
  }

  return { totalPackets: flows.reduce((s, f) => s + f.packetCount, 0), flowCount: flows.length, flows };
}

module.exports = { parseFile, filterFlows };
