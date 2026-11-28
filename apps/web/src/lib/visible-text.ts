// Hidden comments do not show on GitHub, so the user could not know the agent was given them.
export const visibleText = (text: string) => text.replace(/<!--[\s\S]*?(-->|$)/g, "").trim();
