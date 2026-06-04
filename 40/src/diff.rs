use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct DiffResult {
    pub old_size: u64,
    pub new_size: u64,
    pub added_bytes: u64,
    pub removed_bytes: u64,
    pub modified_bytes: u64,
    pub unchanged_bytes: u64,
    pub regions: Vec<DiffRegion>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffRegion {
    pub offset: u64,
    pub old_vaddr: u64,
    pub new_vaddr: u64,
    pub region_type: DiffRegionType,
    pub size: u64,
    pub old_preview: String,
    pub new_preview: String,
}

#[derive(Debug, Clone, Serialize)]
pub enum DiffRegionType {
    Added,
    Removed,
    Modified,
}

pub fn diff_firmware(old_data: &[u8], new_data: &[u8], old_base: u64, new_base: u64) -> DiffResult {
    let old_len = old_data.len();
    let new_len = new_data.len();
    let min_len = old_len.min(new_len);

    let mut added = 0u64;
    let mut removed = 0u64;
    let mut modified = 0u64;
    let mut unchanged = 0u64;
    let mut regions: Vec<DiffRegion> = Vec::new();

    let mut i = 0;
    while i < min_len {
        if old_data[i] != new_data[i] {
            let start = i;
            while i < min_len && old_data[i] != new_data[i] {
                i += 1;
            }
            let region_size = i - start;
            modified += region_size as u64;

            let old_preview = hex_preview(&old_data[start..i.min(old_len)], 32);
            let new_preview = hex_preview(&new_data[start..i.min(new_len)], 32);

            regions.push(DiffRegion {
                offset: start as u64,
                old_vaddr: old_base + start as u64,
                new_vaddr: new_base + start as u64,
                region_type: DiffRegionType::Modified,
                size: region_size as u64,
                old_preview,
                new_preview,
            });
        } else {
            let start = i;
            while i < min_len && old_data[i] == new_data[i] {
                i += 1;
            }
            unchanged += (i - start) as u64;
        }
    }

    if new_len > old_len {
        let extra = (new_len - old_len) as u64;
        added += extra;
        let preview = hex_preview(&new_data[old_len..], 32);
        regions.push(DiffRegion {
            offset: old_len as u64,
            old_vaddr: old_base + old_len as u64,
            new_vaddr: new_base + old_len as u64,
            region_type: DiffRegionType::Added,
            size: extra,
            old_preview: String::new(),
            new_preview: preview,
        });
    } else if old_len > new_len {
        let extra = (old_len - new_len) as u64;
        removed += extra;
        let preview = hex_preview(&old_data[new_len..], 32);
        regions.push(DiffRegion {
            offset: new_len as u64,
            old_vaddr: old_base + new_len as u64,
            new_vaddr: new_base + new_len as u64,
            region_type: DiffRegionType::Removed,
            size: extra,
            old_preview: preview,
            new_preview: String::new(),
        });
    }

    DiffResult {
        old_size: old_len as u64,
        new_size: new_len as u64,
        added_bytes: added,
        removed_bytes: removed,
        modified_bytes: modified,
        unchanged_bytes: unchanged,
        regions,
    }
}

fn hex_preview(data: &[u8], max_bytes: usize) -> String {
    let end = max_bytes.min(data.len());
    let preview: Vec<String> = data[..end].iter().map(|b| format!("{:02x}", b)).collect();
    let mut s = preview.join(" ");
    if data.len() > max_bytes {
        s.push_str(" ...");
    }
    s
}
