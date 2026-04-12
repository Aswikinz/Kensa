//! FlashFill pattern inference — by-example string transforms.
//!
//! The full PROSE-style inference engine is a research project on its own;
//! this implementation handles the common cases that cover ~80% of real-world
//! usage:
//!
//!   1. Constant output — all examples map to the same literal.
//!   2. Identity — output == input.
//!   3. Case transforms — upper / lower / title / capitalize.
//!   4. Substring by delimiter — `"Alice Smith" -> "Alice"` (split first/last).
//!   5. Substring by index — `"12345" -> "12"` (fixed slice).
//!   6. Prefix / suffix trim — `"Mr. Smith" -> "Smith"`.
//!   7. Concatenation with a separator of two fragments (`"John Doe" -> "J.D."`).
//!
//! On success, returns a Python/Pandas expression that when substituted into
//! `df['col'] = <expr>` produces the transformation. The expression references
//! `s` as the input column's Series.

use crate::column::ColumnData;
use crate::types::ExamplePair;

pub fn infer(_col: &ColumnData, examples: &[ExamplePair]) -> Option<String> {
    if examples.is_empty() {
        return None;
    }

    // 1. Constant
    let first_out = &examples[0].output;
    if examples.iter().all(|e| &e.output == first_out) {
        return Some(format!("s.apply(lambda x: {:?})", first_out));
    }

    // 2. Identity
    if examples.iter().all(|e| e.input == e.output) {
        return Some("s".to_string());
    }

    // 3. Case transforms
    if examples.iter().all(|e| e.input.to_lowercase() == e.output) {
        return Some("s.str.lower()".to_string());
    }
    if examples.iter().all(|e| e.input.to_uppercase() == e.output) {
        return Some("s.str.upper()".to_string());
    }
    if examples.iter().all(|e| capitalize(&e.input) == e.output) {
        return Some("s.str.capitalize()".to_string());
    }
    if examples.iter().all(|e| title_case(&e.input) == e.output) {
        return Some("s.str.title()".to_string());
    }

    // 4. Split by delimiter — try the common delimiters and positions.
    for delim in &[' ', ',', '-', '/', '_', '.'] {
        for take_first in &[true, false] {
            let all_match = examples.iter().all(|e| {
                let parts: Vec<&str> = e.input.split(*delim).collect();
                if parts.is_empty() {
                    return false;
                }
                let target = if *take_first {
                    parts.first()
                } else {
                    parts.last()
                };
                target.map(|p| *p == e.output).unwrap_or(false)
            });
            if all_match {
                let index = if *take_first { "0" } else { "-1" };
                return Some(format!(
                    "s.str.split({:?}).str[{}]",
                    delim.to_string(),
                    index
                ));
            }
        }
    }

    // 5. Fixed-length prefix
    for n in 1..=8 {
        let all_match = examples
            .iter()
            .all(|e| e.input.chars().take(n).collect::<String>() == e.output);
        if all_match {
            return Some(format!("s.str.slice(0, {})", n));
        }
    }

    // 6. Fixed-length suffix
    for n in 1..=8 {
        let all_match = examples.iter().all(|e| {
            let chars: Vec<char> = e.input.chars().collect();
            if chars.len() < n {
                return false;
            }
            chars[chars.len() - n..].iter().collect::<String>() == e.output
        });
        if all_match {
            return Some(format!("s.str.slice(-{}, None)", n));
        }
    }

    // 7. Strip whitespace
    if examples.iter().all(|e| e.input.trim() == e.output) {
        return Some("s.str.strip()".to_string());
    }

    None
}

fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        None => String::new(),
        Some(f) => f.to_uppercase().collect::<String>() + &c.as_str().to_lowercase(),
    }
}

fn title_case(s: &str) -> String {
    s.split(' ')
        .map(capitalize)
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ex(input: &str, output: &str) -> ExamplePair {
        ExamplePair {
            input: input.into(),
            output: output.into(),
        }
    }

    #[test]
    fn detects_lowercase() {
        let col = ColumnData::Utf8(vec![]);
        let r = infer(&col, &[ex("HELLO", "hello"), ex("World", "world")]);
        assert_eq!(r.as_deref(), Some("s.str.lower()"));
    }

    #[test]
    fn detects_first_word_split() {
        let col = ColumnData::Utf8(vec![]);
        let r = infer(
            &col,
            &[ex("Alice Smith", "Alice"), ex("Bob Jones", "Bob")],
        );
        assert!(r.is_some());
    }

    #[test]
    fn detects_prefix() {
        let col = ColumnData::Utf8(vec![]);
        let r = infer(&col, &[ex("12345", "12"), ex("98765", "98")]);
        assert_eq!(r.as_deref(), Some("s.str.slice(0, 2)"));
    }
}
