/**
 * Names a skill's block takes from the app around it, on top of Ferry's own placeholders
 * (`getSession`, `getToken`, `userId`, `projectId`...). Declare here, not in the block.
 */
declare function currentUserId(): Promise<string>;
declare function legacyApiTasks(): Promise<{ id: string; projectId: string; title: string }[]>;
