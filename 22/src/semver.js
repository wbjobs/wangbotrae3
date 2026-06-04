const SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

function parseVersion(version) {
  const match = version.match(SEMVER_REGEX);
  if (!match) return null;
  
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || null,
    build: match[5] || null
  };
}

function comparePrerelease(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  
  const partsA = a.split('.');
  const partsB = b.split('.');
  const len = Math.max(partsA.length, partsB.length);
  
  for (let i = 0; i < len; i++) {
    const partA = partsA[i];
    const partB = partsB[i];
    
    if (partA === undefined) return -1;
    if (partB === undefined) return 1;
    
    const isNumA = /^\d+$/.test(partA);
    const isNumB = /^\d+$/.test(partB);
    
    if (isNumA && isNumB) {
      const numA = parseInt(partA, 10);
      const numB = parseInt(partB, 10);
      if (numA !== numB) return numA - numB;
    } else if (isNumA) {
      return -1;
    } else if (isNumB) {
      return 1;
    } else {
      if (partA < partB) return -1;
      if (partA > partB) return 1;
    }
  }
  
  return 0;
}

function compareVersions(a, b) {
  const verA = parseVersion(a);
  const verB = parseVersion(b);
  
  if (!verA || !verB) {
    throw new Error(`Invalid version: ${!verA ? a : b}`);
  }
  
  if (verA.major !== verB.major) return verA.major - verB.major;
  if (verA.minor !== verB.minor) return verA.minor - verB.minor;
  if (verA.patch !== verB.patch) return verA.patch - verB.patch;
  
  return comparePrerelease(verA.prerelease, verB.prerelease);
}

function gte(a, b) {
  return compareVersions(a, b) >= 0;
}

function lte(a, b) {
  return compareVersions(a, b) <= 0;
}

function gt(a, b) {
  return compareVersions(a, b) > 0;
}

function lt(a, b) {
  return compareVersions(a, b) < 0;
}

function eq(a, b) {
  return compareVersions(a, b) === 0;
}

function parseRange(range) {
  range = range.trim();
  
  if (range.includes('||')) {
    return { type: 'or', ranges: range.split('||').map(r => parseRange(r.trim())) };
  }
  
  const parts = range.split(/\s+/);
  if (parts.length > 1) {
    return { type: 'and', ranges: parts.map(r => parseRange(r.trim())) };
  }
  
  if (range.includes(' - ')) {
    const [start, end] = range.split(' - ').map(s => s.trim());
    return { type: 'range', start, end };
  }
  
  if (range.startsWith('^')) {
    return { type: 'caret', version: range.slice(1) };
  }
  
  if (range.startsWith('~')) {
    return { type: 'tilde', version: range.slice(1) };
  }
  
  if (range.startsWith('>=')) {
    return { type: 'gte', version: range.slice(2) };
  }
  
  if (range.startsWith('<=')) {
    return { type: 'lte', version: range.slice(2) };
  }
  
  if (range.startsWith('>')) {
    return { type: 'gt', version: range.slice(1) };
  }
  
  if (range.startsWith('<')) {
    return { type: 'lt', version: range.slice(1) };
  }
  
  if (range === '*' || range === 'x' || range === 'X') {
    return { type: 'any' };
  }
  
  if (/^\d/.test(range)) {
    return { type: 'exact', version: range };
  }
  
  return { type: 'any' };
}

function satisfiesRange(version, parsedRange) {
  switch (parsedRange.type) {
    case 'any':
      return true;
      
    case 'exact':
      return eq(version, parsedRange.version);
      
    case 'gte':
      return gte(version, parsedRange.version);
      
    case 'lte':
      return lte(version, parsedRange.version);
      
    case 'gt':
      return gt(version, parsedRange.version);
      
    case 'lt':
      return lt(version, parsedRange.version);
      
    case 'caret': {
      const ver = parseVersion(parsedRange.version);
      if (!ver) return false;
      
      if (ver.major > 0) {
        return gte(version, parsedRange.version) && lt(version, `${ver.major + 1}.0.0`);
      } else if (ver.minor > 0) {
        return gte(version, parsedRange.version) && lt(version, `0.${ver.minor + 1}.0`);
      } else {
        return gte(version, parsedRange.version) && lt(version, `0.0.${ver.patch + 1}`);
      }
    }
    
    case 'tilde': {
      const ver = parseVersion(parsedRange.version);
      if (!ver) return false;
      return gte(version, parsedRange.version) && lt(version, `${ver.major}.${ver.minor + 1}.0`);
    }
    
    case 'range':
      return gte(version, parsedRange.start) && lte(version, parsedRange.end);
      
    case 'or':
      return parsedRange.ranges.some(r => satisfiesRange(version, r));
      
    case 'and':
      return parsedRange.ranges.every(r => satisfiesRange(version, r));
      
    default:
      return false;
  }
}

function satisfies(version, range) {
  const parsedRange = parseRange(range);
  return satisfiesRange(version, parsedRange);
}

function maxSatisfying(versions, range) {
  const validVersions = versions.filter(v => satisfies(v, range));
  if (validVersions.length === 0) return null;
  
  validVersions.sort(compareVersions);
  return validVersions[validVersions.length - 1];
}

function intersectRanges(ranges) {
  if (ranges.length === 0) return [];
  
  const normalizedRanges = ranges.map(r => r.split(/\s*\|\|\s*/).map(s => s.trim()));
  
  let result = normalizedRanges[0];
  
  for (let i = 1; i < normalizedRanges.length; i++) {
    const intersections = [];
    
    for (const existing of result) {
      for (const current of normalizedRanges[i]) {
        const intersection = intersectTwoRanges(existing, current);
        if (intersection) {
          intersections.push(intersection);
        }
      }
    }
    
    if (intersections.length === 0) {
      return null;
    }
    
    result = [...new Set(intersections)];
  }
  
  return result;
}

function intersectTwoRanges(range1, range2) {
  if (range1 === '*' || range1 === '') return range2;
  if (range2 === '*' || range2 === '') return range1;
  
  const lower1 = getLowerBound(range1);
  const upper1 = getUpperBound(range1);
  const lower2 = getLowerBound(range2);
  const upper2 = getUpperBound(range2);
  
  const lower = (lower1 === null || (lower2 !== null && gte(lower2.version, lower1.version))) ? lower2 : lower1;
  const upper = (upper1 === null || (upper2 !== null && lte(upper2.version, upper1.version))) ? upper2 : upper1;
  
  if (lower && upper) {
    if (lower.inclusive && upper.inclusive) {
      if (gt(lower.version, upper.version)) return null;
    } else {
      if (gte(lower.version, upper.version)) return null;
    }
  }
  
  return buildRange(lower, upper);
}

function getLowerBound(range) {
  const parsed = parseRange(range);
  
  switch (parsed.type) {
    case 'any':
      return null;
    case 'exact':
      return { version: parsed.version, inclusive: true };
    case 'gte':
      return { version: parsed.version, inclusive: true };
    case 'gt':
      return { version: parsed.version, inclusive: false };
    case 'caret':
    case 'tilde':
      return { version: parsed.version, inclusive: true };
    case 'range':
      return { version: parsed.start, inclusive: true };
    case 'and': {
      let lower = null;
      for (const r of parsed.ranges) {
        const subLower = getLowerBoundFromParsed(r);
        if (subLower && (!lower || gte(subLower.version, lower.version))) {
          lower = subLower;
        }
      }
      return lower;
    }
    case 'or': {
      let lower = null;
      for (const r of parsed.ranges) {
        const subLower = getLowerBoundFromParsed(r);
        if (subLower && (!lower || lt(subLower.version, lower.version))) {
          lower = subLower;
        }
      }
      return lower;
    }
    default:
      return null;
  }
}

function getLowerBoundFromParsed(parsed) {
  switch (parsed.type) {
    case 'any':
      return null;
    case 'exact':
      return { version: parsed.version, inclusive: true };
    case 'gte':
      return { version: parsed.version, inclusive: true };
    case 'gt':
      return { version: parsed.version, inclusive: false };
    case 'caret':
    case 'tilde':
      return { version: parsed.version, inclusive: true };
    case 'range':
      return { version: parsed.start, inclusive: true };
    default:
      return null;
  }
}

function getUpperBound(range) {
  const parsed = parseRange(range);
  return getUpperBoundFromParsed(parsed);
}

function getUpperBoundFromParsed(parsed) {
  switch (parsed.type) {
    case 'any':
    case 'gte':
    case 'gt':
      return null;
    case 'exact':
      return { version: parsed.version, inclusive: true };
    case 'lte':
      return { version: parsed.version, inclusive: true };
    case 'lt':
      return { version: parsed.version, inclusive: false };
    case 'caret': {
      const ver = parseVersion(parsed.version);
      if (!ver) return null;
      if (ver.major > 0) {
        return { version: `${ver.major + 1}.0.0`, inclusive: false };
      } else if (ver.minor > 0) {
        return { version: `0.${ver.minor + 1}.0`, inclusive: false };
      } else {
        return { version: `0.0.${ver.patch + 1}`, inclusive: false };
      }
    }
    case 'tilde': {
      const ver = parseVersion(parsed.version);
      if (!ver) return null;
      return { version: `${ver.major}.${ver.minor + 1}.0`, inclusive: false };
    }
    case 'range':
      return { version: parsed.end, inclusive: true };
    case 'and': {
      let upper = null;
      for (const r of parsed.ranges) {
        const subUpper = getUpperBoundFromParsed(r);
        if (subUpper && (!upper || lte(subUpper.version, upper.version))) {
          upper = subUpper;
        }
      }
      return upper;
    }
    case 'or': {
      let upper = null;
      for (const r of parsed.ranges) {
        const subUpper = getUpperBoundFromParsed(r);
        if (subUpper && (!upper || gt(subUpper.version, upper.version))) {
          upper = subUpper;
        }
      }
      return upper;
    }
    default:
      return null;
  }
}

function buildRange(lower, upper) {
  if (!lower && !upper) return '*';
  if (!lower) {
    return upper.inclusive ? `<=${upper.version}` : `<${upper.version}`;
  }
  if (!upper) {
    return lower.inclusive ? `>=${lower.version}` : `>${lower.version}`;
  }
  if (lower.inclusive && upper.inclusive && eq(lower.version, upper.version)) {
    return lower.version;
  }
  return `${lower.inclusive ? '>=' : '>'}${lower.version} ${upper.inclusive ? '<=' : '<'}${upper.version}`;
}

module.exports = {
  parseVersion,
  compareVersions,
  gte,
  lte,
  gt,
  lt,
  eq,
  parseRange,
  satisfies,
  maxSatisfying,
  intersectRanges,
  getLowerBound,
  getUpperBound,
  intersectTwoRanges
};
