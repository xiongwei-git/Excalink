// Internal facade only. This is not an MCP transport or authentication implementation.
export class CurrentBoardService {
  constructor(store) { this.store = store; }
  read() {
    const { share: _share, ...board } = this.store.current();
    return board;
  }
  async replace(input) {
    if (Object.hasOwn(input, 'boardId') || Object.hasOwn(input, 'documentId') || Object.hasOwn(input, 'path')) {
      throw new Error('MCP一期仅允许操作当前白板');
    }
    return this.store.updateCurrent(input);
  }
}
