import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { HanaDataClient } from './utils/HanaConnection';

export class SapHanaData implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SAP HANA Data',
		name: 'sapHanaData',
		icon: 'file:saphana.svg',
		group: ['input'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["tableName"]}}',
		description: 'Read data from SAP HANA tables and HDI containers',
		defaults: {
			name: 'SAP HANA Data',
		},
		inputs: ['main'] as any,
		outputs: ['main'] as any,
		usableAsTool: true,
		credentials: [
			{
				name: 'sapHanaDataApi',
				required: true,
			},
		],
		properties: [
			// Operation selection
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Get All Records',
						value: 'getAll',
						description: 'Retrieve all records from a table',
						action: 'Get all records from table',
					},
					{
						name: 'Get Records with Filter',
						value: 'getFiltered',
						description: 'Retrieve records with WHERE conditions',
						action: 'Get filtered records from table',
					},
				],
				default: 'getAll',
				description: 'Choose the operation to perform',
			},

			// Table name field
			{
				displayName: 'Table Name',
				name: 'tableName',
				type: 'string',
				default: '',
				placeholder: 'e.g., CUSTOMERS',
				description: 'Name of the table to read from',
				required: true,
			},

			// Limit field
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 0,
				placeholder: '0 for no limit',
				description: 'Maximum number of records to return (0 for no limit)',
				typeOptions: {
					minValue: 0,
					maxValue: 100000,
				},
			},

			// WHERE condition for filtered queries
			{
				displayName: 'WHERE Condition',
				name: 'whereCondition',
				type: 'string',
				default: '',
				placeholder: 'e.g., STATUS = \'ACTIVE\' AND CREATED_DATE > \'2024-01-01\'',
				description: 'WHERE clause condition (without the WHERE keyword)',
				displayOptions: {
					show: {
						operation: ['getFiltered'],
					},
				},
				required: true,
			},

			// Options section
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Columns',
						name: 'columns',
						type: 'string',
						default: '*',
						placeholder: 'e.g., ID, NAME, EMAIL or * for all columns',
						description: 'Comma-separated list of columns to retrieve, or * for all columns',
					},
					{
						displayName: 'Order By',
						name: 'orderBy',
						type: 'string',
						default: '',
						placeholder: 'e.g., CREATED_DATE DESC, NAME ASC',
						description: 'ORDER BY clause (without the ORDER BY keyword)',
					},
				],
			},

			// Help notice
			{
				displayName: 'SAP HANA Connection Info',
				name: 'hanaNotice',
				type: 'notice',
				default: '',
				typeOptions: {
					theme: 'info',
				},
				description: '💡 Ensure your HANA user has SELECT permissions on the target tables. For HDI containers, use the schema from your service key.',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// Validate input items
		if (!items || items.length === 0) {
			throw new NodeOperationError(this.getNode(), 'No input data provided');
		}

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				const credentials = await this.getCredentials('sapHanaDataApi');
				const tableName = this.getNodeParameter('tableName', i) as string;
				const limit = this.getNodeParameter('limit', i, 0) as number;
				const includeMetadata = this.getNodeParameter('includeMetadata', i, true) as boolean;
				const returnArrayFormat = this.getNodeParameter('returnArrayFormat', i, false) as boolean;
				const options = this.getNodeParameter('options', i, {}) as any;

				// Get columns and orderBy from options
				const columns = options.columns || '*';
				const orderBy = options.orderBy || '';

				const client = new HanaDataClient(credentials);

				let results: any[] = [];
				let queryInfo: any = {};

				try {
					// Connect to HANA
					await client.connect();

					// Execute based on operation
					switch (operation) {
						case 'getAll': {
							results = await client.getAllRecords(tableName, columns);
							
							// Apply order by and limit if specified
							if (orderBy || limit > 0) {
								results = await client.getFilteredRecords(
									tableName, 
									'1=1', // Always true condition
									columns, 
									orderBy || undefined, 
									limit > 0 ? limit : undefined
								);
							}

							queryInfo = {
								operation: 'getAll',
								tableName,
								columns,
								orderBy,
								limit: limit > 0 ? limit : null,
							};
							break;
						}

						case 'getFiltered': {
							const whereCondition = this.getNodeParameter('whereCondition', i) as string;

							results = await client.getFilteredRecords(
								tableName,
								whereCondition,
								columns,
								orderBy || undefined,
								limit > 0 ? limit : undefined
							);

							queryInfo = {
								operation: 'getFiltered',
								tableName,
								whereCondition,
								columns,
								orderBy,
								limit: limit > 0 ? limit : null,
							};
							break;
						}

						default:
							throw new NodeOperationError(
								this.getNode(),
								`Unknown operation: ${operation}`,
								{ itemIndex: i }
							);
					}

					// Format output based on options
					if (returnArrayFormat) {
						// Return as single item with array
						const outputItem: INodeExecutionData = {
							json: {
								success: true,
								timestamp: new Date().toISOString(),
								...queryInfo,
								rowCount: results.length,
								data: results,
							},
							pairedItem: { item: i },
						};

						if (includeMetadata) {
							outputItem.json.metadata = {
								...queryInfo,
								totalRows: results.length,
								timestamp: new Date().toISOString(),
							};
						}

						returnData.push(outputItem);
					} else {
						// Return each row as separate item
						if (results.length === 0) {
							// Return empty result info if no data found
							returnData.push({
								json: {
									success: true,
									timestamp: new Date().toISOString(),
									...queryInfo,
									rowCount: 0,
									message: 'No records found',
								},
								pairedItem: { item: i },
							});
						} else {
							// Add metadata to first item if requested
							for (let j = 0; j < results.length; j++) {
								const outputItem: INodeExecutionData = {
									json: results[j],
									pairedItem: { item: i },
								};

								// Add metadata to first item
								if (j === 0 && includeMetadata) {
									outputItem.json._metadata = {
										...queryInfo,
										totalRows: results.length,
										timestamp: new Date().toISOString(),
									};
								}

								returnData.push(outputItem);
							}
						}
					}

				} finally {
					// Always disconnect
					await client.disconnect();
				}

			} catch (error: any) {
				if (this.continueOnFail()) {
					const errorResult: INodeExecutionData = {
						json: {
							error: {
								message: error.message,
								type: error.constructor.name,
								itemIndex: i,
							},
							success: false,
							timestamp: new Date().toISOString(),
						},
						pairedItem: { item: i },
					};
					returnData.push(errorResult);
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`SAP HANA Read operation failed: ${error.message}`,
						{ itemIndex: i }
					);
				}
			}
		}

		return [returnData];
	}
}