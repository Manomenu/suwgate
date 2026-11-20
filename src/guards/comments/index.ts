import type { Guard } from "../../gate/contract.ts";
import { commentsCsharp } from "./csharp.ts";
import { commentsCss } from "./css.ts";
import { commentsEslint } from "./eslint.ts";
import { commentsHash } from "./hash.ts";
import { commentsJson } from "./json.ts";
import { commentsMarkup } from "./markup.ts";
import { commentsSql } from "./sql.ts";
import { noInPlaceSwitches } from "./switches.ts";

export const commentGuards: readonly Guard[] = [
    commentsHash,
    commentsCss,
    commentsJson,
    commentsMarkup,
    commentsSql,
    commentsCsharp,
    commentsEslint,
    noInPlaceSwitches,
];
