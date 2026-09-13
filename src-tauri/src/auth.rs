/// RFC 7636 restricts the verifier to 43-128 unreserved characters.
pub fn verifier_is_valid(verifier: &str) -> bool {
    let length = verifier.chars().count();
    (43..=128).contains(&length)
        && verifier
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-._~".contains(character))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_conforming_verifier() {
        assert!(verifier_is_valid("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"));
    }

    #[test]
    fn rejects_a_short_verifier() {
        assert!(!verifier_is_valid("too-short"));
    }

    #[test]
    fn rejects_reserved_characters() {
        assert!(!verifier_is_valid(&"a".repeat(42).to_string().replace('a', "!")));
    }
}
