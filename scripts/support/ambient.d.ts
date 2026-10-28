/**
 * Names a skill's block takes from the app around it, on top of Ferry's own placeholders
 * (`getSession`, `getToken`, `userId`, `projectId`...). Declare here, not in the block.
 */
declare function currentUserId(): Promise<string>;
declare function legacyApiTasks(): Promise<{ id: string; projectId: string; title: string }[]>;
/** An existing permission check of the app's own: may this user edit this project's tasks? */
declare function canEdit(userId: string, projectId: string): Promise<boolean>;
/** An existing membership table of the app's own: the user ids of a project. */
declare function legacyMembersOf(projectId: string): Promise<string[]>;
