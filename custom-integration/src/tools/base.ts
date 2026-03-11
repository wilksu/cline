export abstract class BaseTool {
    constructor(protected readonly workspaceRoot: string) {}
    abstract execute(args: string[]): Promise<any>;
}
