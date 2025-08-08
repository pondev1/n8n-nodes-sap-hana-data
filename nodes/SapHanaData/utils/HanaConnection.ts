import * as hana from '@sap/hana-client';
import type { ICredentialDataDecryptedObject } from 'n8n-workflow';

export interface HanaConnectionConfig {
	host: string;
	port: number;
	username: string;
	password: string;
	database?: string;
	encrypt?: boolean;
	connectTimeout?: number;
	currentSchema?: string;
}

export class HanaDataClient {
	private connection: any;
	private config: HanaConnectionConfig;

	constructor(credentials: ICredentialDataDecryptedObject) {
		this.config = {
			host: credentials.host as string,
			port: credentials.port as number,
			username: credentials.username as string,
			password: credentials.password as string,
			database: credentials.database as string,
			encrypt: credentials.encrypt as boolean ?? true,
			connectTimeout: credentials.connectTimeout as number ?? 15000,
			currentSchema: credentials.currentSchema as string,
		};
	}

	async connect(): Promise<void> {
		const connOptions = {
			host: this.config.host,
			port: this.config.port,
			user: this.config.username,
			password: this.config.password,
			database: this.config.database,
			encrypt: this.config.encrypt,
			connectTimeout: this.config.connectTimeout,
			currentSchema: this.config.currentSchema,
		};

		this.connection = hana.createConnection();
		
		return new Promise((resolve, reject) => {
			this.connection.connect(connOptions, (err: any) => {
				if (err) {
					reject(new Error(`HANA connection failed: ${err.message}`));
				} else {
					resolve();
				}
			});
		});
	}

	async disconnect(): Promise<void> {
		if (this.connection) {
			return new Promise((resolve) => {
				this.connection.disconnect((err: any) => {
					if (err) console.warn('HANA disconnect warning:', err.message);
					resolve();
				});
			});
		}
	}

	async executeQuery(query: string, params: any[] = []): Promise<any[]> {
		return new Promise((resolve, reject) => {
			this.connection.exec(query, params, (err: any, result: any[]) => {
				if (err) {
					reject(new Error(`Query execution failed: ${err.message}`));
				} else {
					resolve(result);
				}
			});
		});
	}

	// Data reading operations
	async getAllRecords(tableName: string, columns: string = '*'): Promise<any[]> {
		const query = `SELECT ${columns} FROM ${tableName}`;
		return await this.executeQuery(query);
	}

	async getFilteredRecords(
		tableName: string, 
		whereCondition: string, 
		columns: string = '*',
		orderBy?: string,
		limit?: number
	): Promise<any[]> {
		let query = `SELECT ${columns} FROM ${tableName} WHERE ${whereCondition}`;
		
		if (orderBy) {
			query += ` ORDER BY ${orderBy}`;
		}
		
		if (limit && limit > 0) {
			query += ` LIMIT ${limit}`;
		}
		
		return await this.executeQuery(query);
	}

	async executeCustomQuery(query: string, params: any[] = []): Promise<any[]> {
		return await this.executeQuery(query, params);
	}

	async testConnection(): Promise<boolean> {
		try {
			const result = await this.executeQuery('SELECT 1 as test FROM DUMMY');
			return result.length > 0;
		} catch (error) {
			return false;
		}
	}

	async getTableInfo(tableName: string): Promise<any[]> {
		const query = `
			SELECT COLUMN_NAME, DATA_TYPE_NAME, LENGTH, SCALE, IS_NULLABLE
			FROM TABLE_COLUMNS 
			WHERE SCHEMA_NAME = CURRENT_SCHEMA 
			AND TABLE_NAME = ?
			ORDER BY POSITION
		`;
		return await this.executeQuery(query, [tableName]);
	}
}