use phira_content_policy_types::{ContentPolicy, Status};
use serde::{Deserialize, Serialize};

/// 曲目 Meilisearch 索引文档。
///
/// 主键为 `id`，格式 `"track:{name}|{artist}"`。
/// 版权方曲目内嵌 RH 信息；独立曲目 rh_* 字段为 None。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CpTrackDoc {
    pub id: String,
    pub name: String,
    pub artist: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
    /// None 表示继承所属 Rights Holder 的 policy
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<Status>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// 所属版权方名称。独立曲目为 None。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rh_name: Option<String>,
    /// 所属版权方 status。独立曲目为 None。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rh_status: Option<Status>,
    /// 所属版权方备注。独立曲目为 None。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rh_note: Option<String>,
}

/// 艺人 Meilisearch 索引文档。
///
/// 主键为 `id`，格式 `"artist:{artist_id}"`（data/artists/ 下的文件名不含 .toml）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CpArtistDoc {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
    pub status: Status,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// 版权方 Meilisearch 索引文档。
///
/// 主键为 `id`，格式 `"rh:{rh_id}"`（data/rights_holders/ 下的目录名）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CpRightsHolderDoc {
    pub id: String,
    pub name: String,
    pub status: Status,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    pub track_count: usize,
}

/// 从 [`ContentPolicy`] 构建曲目索引文档。
pub fn build_track_docs(policy: &ContentPolicy) -> Vec<CpTrackDoc> {
    let mut docs = Vec::new();

    for (_rh_id, rh) in &policy.rights_holders {
        for track in &rh.tracks {
            docs.push(CpTrackDoc {
                id: format!("track:{}|{}", track.name, track.artist),
                name: track.name.clone(),
                artist: track.artist.clone(),
                aliases: track.aliases.clone(),
                status: track.status,
                note: track.note.clone(),
                rh_name: Some(rh.policy.name.clone()),
                rh_status: Some(rh.policy.status),
                rh_note: rh.policy.note.clone(),
            });
        }
    }
    for track in &policy.independent_tracks {
        docs.push(CpTrackDoc {
            id: format!("track:{}|{}", track.name, track.artist),
            name: track.name.clone(),
            artist: track.artist.clone(),
            aliases: track.aliases.clone(),
            status: Some(track.status),
            note: track.note.clone(),
            rh_name: None,
            rh_status: None,
            rh_note: None,
        });
    }
    docs
}

/// 从 [`ContentPolicy`] 构建艺人索引文档。
pub fn build_artist_docs(policy: &ContentPolicy) -> Vec<CpArtistDoc> {
    policy
        .artists
        .iter()
        .map(|(artist_id, artist)| CpArtistDoc {
            id: format!("artist:{artist_id}"),
            name: artist.name.clone(),
            aliases: artist.aliases.clone(),
            status: artist.status,
            reason: artist.reason.clone(),
            note: artist.note.clone(),
        })
        .collect()
}

/// 从 [`ContentPolicy`] 构建版权方索引文档。
pub fn build_rh_docs(policy: &ContentPolicy) -> Vec<CpRightsHolderDoc> {
    policy
        .rights_holders
        .iter()
        .map(|(rh_id, rh)| CpRightsHolderDoc {
            id: format!("rh:{rh_id}"),
            name: rh.policy.name.clone(),
            status: rh.policy.status,
            note: rh.policy.note.clone(),
            track_count: rh.tracks.len(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_track_docs_id_format() {
        let docs = build_track_docs(&ContentPolicy::default());
        for d in docs {
            assert!(d.id.starts_with("track:"), "id={}", d.id);
            assert!(d.id.contains('|'), "id={}", d.id);
        }
    }

    #[test]
    fn test_build_artist_docs_id_format() {
        let docs = build_artist_docs(&ContentPolicy::default());
        for d in docs {
            assert!(d.id.starts_with("artist:"), "id={}", d.id);
        }
    }

    #[test]
    fn test_build_rh_docs_id_format() {
        let docs = build_rh_docs(&ContentPolicy::default());
        for d in docs {
            assert!(d.id.starts_with("rh:"), "id={}", d.id);
        }
    }
}
