export class ThreadStore {
	private _dataView: DataView

	/**
	 * Takes a `sharedArrayBuffer` and returns a `ThreadStore` that can set and get the values from it.
	 * @param {SharedArrayBuffer} sharedArrayBuffer Shared memory that another ThreadStore is using.
	 */
	constructor(sharedArrayBuffer: SharedArrayBuffer) {
		this._dataView = new DataView(sharedArrayBuffer);
	}

	_setBool(byteOffset: number, value: boolean): void { 
		if (value === true) this._dataView.setUint8(byteOffset, 1);
		else if (value === false) this._dataView.setUint8(byteOffset, 0);
		else throw new Error(`Property must be of type boolean. Was ${value}, type ${typeof value}.`);
	}

	_getBool(byteOffset: number): boolean {
		const bool = this._dataView.getUint8(byteOffset);
		if (bool === 0) return false;
		else if (bool === 1) return true;
		else throw new Error(`Boolean value retrieved was ${bool}, expected 0 or 1.`);
	}

	set queued(value: number) { this._dataView.setInt32(0, value); }
	get queued(): number { return this._dataView.getInt32(0); }

	set working(value: number) { this._dataView.setInt32(4, value); }
	get working(): number { return this._dataView.getInt32(4); }
}