use serde::{Deserialize, Serialize};

/// Which of the two timed tests a student is sitting. Both draw from every
/// point-value band of the topic; they differ only in how many questions
/// each band contributes.
///
/// "Úvodní" is the first test of a topic and takes 5 per band (15 in all);
/// "průběžný" is the recurring one and takes 4 (12) — the shape every test
/// had before the split, which is why existing topics default to it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TestKind {
    Uvodni,
    Prubezny,
}

impl TestKind {
    pub fn as_str(self) -> &'static str {
        match self {
            TestKind::Uvodni => "uvodni",
            TestKind::Prubezny => "prubezny",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "uvodni" => Some(TestKind::Uvodni),
            "prubezny" => Some(TestKind::Prubezny),
            _ => None,
        }
    }

    /// How many questions this kind draws from each of
    /// `commands::test_session::TEST_POINT_VALUE_BANDS`.
    pub fn questions_per_band(self) -> usize {
        match self {
            TestKind::Uvodni => 5,
            TestKind::Prubezny => 4,
        }
    }
}

/// Which test(s) a topic flagged `is_test` offers. A topic can serve as the
/// úvodní test, the průběžný one, or both — the teacher cycles through these
/// on the topic card, and `is_test` still decides whether it is a test at all.
///
/// Offering both is not free: the úvodní test wants 5 questions in every
/// band and the průběžný one 4, so a "both" topic has to satisfy the larger
/// of the two before it is listed for úvodní.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TestOffer {
    Uvodni,
    Prubezny,
    Both,
}

impl TestOffer {
    pub fn as_str(self) -> &'static str {
        match self {
            TestOffer::Uvodni => "uvodni",
            TestOffer::Prubezny => "prubezny",
            TestOffer::Both => "both",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "uvodni" => Some(TestOffer::Uvodni),
            "prubezny" => Some(TestOffer::Prubezny),
            "both" => Some(TestOffer::Both),
            _ => None,
        }
    }

    /// Whether a student may sit `kind` on this topic.
    pub fn offers(self, kind: TestKind) -> bool {
        match self {
            TestOffer::Both => true,
            TestOffer::Uvodni => kind == TestKind::Uvodni,
            TestOffer::Prubezny => kind == TestKind::Prubezny,
        }
    }
}

impl Default for TestOffer {
    fn default() -> Self {
        TestOffer::Prubezny
    }
}
