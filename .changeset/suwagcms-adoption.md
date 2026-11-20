---
"@maniumek/suwgate": patch
---

The guard `forbidden-names` refuses `base` only in the name of a folder or project, no longer in a file's: a file is named after the
type it holds, and `architecture/forbidden-type-names` allows Base in a type's name (`KnowledgeBaseView.cs`), as it forbids it only as
a namespace segment.
