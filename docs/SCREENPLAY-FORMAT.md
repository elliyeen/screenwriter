# Screenplay format

Studio layout on US Letter, Courier 12pt (10 characters per inch, 6 lines per inch).

| Element | Left edge (column) | Width (characters) | Notes |
|---|---|---|---|
| Page | 1.5" left margin, 1" right, 1" top and bottom | 54 lines of text per page | |
| Scene heading | 15 | 60 | Capitals. Optional bold and scene numbers. |
| Action | 15 | 60 | |
| Character cue | 35 | | Capitals. `(CONT'D)` added when the same character continues. |
| Parenthetical | 30 | 25 | |
| Dialogue | 25 | 35 | |
| Transition | right aligned at 75 | | Example: CUT TO: |
| Page number | top right from page 2 | | `2.` style |

Columns are counted from the paper's left edge in characters.

## Pagination rules

- A scene heading is never left alone at the bottom of a page.
- A character cue is kept with at least part of its dialogue.
- Dialogue split across pages shows `(MORE)` at the bottom and `NAME (CONT'D)` at the top of the next page.
- Parentheticals stay with the dialogue that follows.

## Why fixed columns

The engine places text by character column, not by measured pixels, so a different font rendering cannot change line
wraps or page breaks. Courier Prime and the PDF's built-in Courier have the same character width.
In the browser, Courier Prime 12pt measures 60 characters as 6.00 inches (within 0.1%). The PDF uses the standard PDF Courier
fonts. Embedding Courier Prime into the PDF is on the roadmap.

## Fountain support

Title page keys (Title, Credit, Author, Draft date, Contact, Copyright, Notes), scene headings (INT., EXT., and forced
headings), action (forced with `!`), character cues, parentheticals, dialogue, transitions (ending in `TO:` or forced with `>`),
bold, italic and underline. `/* boneyard */` comments and `[[notes]]` are ignored in the layout.

## Studio check

The check lists problems as **Fix** (format that should be corrected) or **Tip** (worth a look). Mechanical fixes can be
applied in one click, and applying them twice changes nothing more. It checks format, not story.

Fix examples: missing title page or author, scene heading not starting with INT. or EXT., no time of day, heading not in
capitals, parenthetical with no dialogue, two spellings of one character.

Tip examples: action blocks longer than 4 lines, camera directions, a typed (CONT'D) the app would add itself, speeches
longer than 10 lines, parentheticals on many speeches, a transition after almost every scene, script length for its type.
