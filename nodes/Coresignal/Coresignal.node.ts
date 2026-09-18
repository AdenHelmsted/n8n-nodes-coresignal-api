import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
	IHttpRequestOptions,
	NodeApiError,
	NodeConnectionTypes,
	JsonObject,
} from 'n8n-workflow';

const MAX_ITEMS_PER_PAGE = 1000;
const PREVIEW_PAGE_SIZE = 20;
const PREVIEW_MAX_PAGE = 50;

type SearchResponse = { body: IDataObject[] | number[]; headers: IDataObject };
type SearchResult = IDataObject | number;

async function runSearch(
	context: IExecuteFunctions,
	itemIndex: number,
	endpoint: string,
): Promise<SearchResult[]> {
	const preview = context.getNodeParameter('preview', itemIndex, false) as boolean;
	const options = context.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const esQuery = context.getNodeParameter('esQuery', itemIndex) as IDataObject;

	const request = async (qs: IDataObject): Promise<SearchResponse> =>
		(await context.helpers.httpRequestWithAuthentication.call(context, 'coresignalApi', {
			method: 'POST',
			url: `${endpoint}/search/es_dsl${preview ? '/preview' : ''}`,
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
			qs,
			body: esQuery,
			returnFullResponse: true,
		})) as SearchResponse;

	const results: SearchResult[] = [];
	const pagination: IDataObject = {};

	if (preview) {
		const page = (options.page as number) || 1;
		const qs: IDataObject = { page };
		if (options.snapshotId) {
			qs.snapshot_token = options.snapshotId;
		} else if (options.snapshot === true) {
			qs.snapshot = true;
		}

		const response = await request(qs);
		results.push(...(response.body as IDataObject[]));

		const totalResults = Number(response.headers['x-total-results']);
		const isLastPage = page * PREVIEW_PAGE_SIZE >= totalResults || page >= PREVIEW_MAX_PAGE;
		pagination.totalResults = totalResults;
		pagination.nextPage = isLastPage ? null : page + 1;
		pagination.snapshotId = (response.headers['x-snapshot-token'] as string) || null;
	} else {
		const returnAll = context.getNodeParameter('returnAll', itemIndex, false) as boolean;
		const limit = returnAll
			? Infinity
			: (context.getNodeParameter('maxResults', itemIndex) as number);
		let after = (options.after as string) || '';

		while (results.length < limit) {
			const qs: IDataObject = {
				items_per_page: Math.min(limit - results.length, MAX_ITEMS_PER_PAGE),
			};
			if (after) {
				qs.after = after;
			}

			const response = await request(qs);
			const ids = response.body as number[];
			results.push(...ids);
			after = response.headers['x-next-page-after'] as string;

			// The API sends the literal string "None" on the last page
			const isLastPage = !after || after === 'None' || ids.length === 0;
			pagination.totalResults = Number(response.headers['x-total-results']);
			pagination.nextPageAfter = isLastPage ? null : after;
			if (isLastPage) break;
		}
	}

	if (options.includePaginationInfo === true) {
		return [{ results, pagination }];
	}
	return results;
}

export class Coresignal implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Coresignal',
		name: 'coresignal',
		icon: 'file:logo.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + " - " + $parameter["resource"]}}',
		description: 'Interact with Coresignal API for company, employee, job, and post data',
		documentationUrl: 'https://docs.coresignal.com/?utm_source=n8n&utm_medium=referral',
		defaults: {
			name: 'Coresignal',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'coresignalApi',
				required: true,
			},
		],
		properties: [
			// Resource Selection
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Company',
						value: 'company',
						description: 'Access company data and profiles',
					},
					{
						name: 'Employee',
						value: 'employee',
						description: 'Access employee data and profiles',
					},
					{
						name: 'Employee Post',
						value: 'post',
						description: 'Access employee posts data',
					},
					{
						name: 'Job',
						value: 'job',
						description: 'Access jobs data',
					},
				],
				default: 'employee',
			},

			// ============ OPERATION SELECTIONS ============

			// Operation - Company
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['company'],
					},
				},
				options: [
					{
						name: 'Enrich by Website',
						value: 'enrich',
						description: 'Enrich company data using a website URL',
						action: 'Enrich company by website URL',
					},
					{
						name: 'Get by ID',
						value: 'get_by_id',
						description: 'Retrieve a full company profile using a company ID',
						action: 'Get company by ID',
					},
					{
						name: 'Get by Slug',
						value: 'get_by_slug',
						description: 'Retrieve a full company profile using a URL slug',
						action: 'Get company by URL slug',
					},
					{
						name: 'Search with Elasticsearch DSL',
						value: 'search_es_dsl',
						description: 'Search companies using an Elasticsearch DSL query',
						action: 'Search companies using elasticsearch DSL',
					},
				],
				default: 'get_by_id',
			},

			// Operation - Employee
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['employee'],
					},
				},
				options: [
					{
						name: 'Get by ID',
						value: 'get_by_id',
						description: 'Retrieve a full employee profile using an employee ID',
						action: 'Get employee by ID',
					},
					{
						name: 'Get by Slug',
						value: 'get_by_slug',
						description: 'Retrieve a full employee profile using a URL slug',
						action: 'Get employee by URL slug',
					},
					{
						name: 'Search with Elasticsearch DSL',
						value: 'search_es_dsl',
						description: 'Search employees using an Elasticsearch DSL query',
						action: 'Search employees using elasticsearch DSL',
					},
				],
				default: 'get_by_id',
			},

			// Operation - Jobs
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['job'],
					},
				},
				options: [
					{
						name: 'Get by ID',
						value: 'get_by_id',
						description: 'Retrieve a full job posting using a job ID',
						action: 'Get job by ID',
					},
					{
						name: 'Search with Elasticsearch DSL',
						value: 'search_es_dsl',
						description: 'Search jobs using an Elasticsearch DSL query',
						action: 'Search jobs using elasticsearch DSL',
					},
				],
				default: 'get_by_id',
			},

			// Operation - Posts
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['post'],
					},
				},
				options: [
					{
						name: 'Get by ID',
						value: 'get_by_id',
						description: 'Retrieve a full employee post using a post ID',
						action: 'Get employee post by ID',
					},
					{
						name: 'Search with Elasticsearch DSL',
						value: 'search_es_dsl',
						description: 'Search employee posts using an Elasticsearch DSL query',
						action: 'Search employee posts using elasticsearch DSL',
					},
				],
				default: 'get_by_id',
			},

			// ============ INPUT DATA ============

			// ID Parameter - Company
			{
				displayName: 'Company ID',
				name: 'companyId',
				type: 'string',
				required: true,
				displayOptions: {
					show: {
						resource: ['company'],
						operation: ['get_by_id'],
					},
				},
				default: '',
				description: 'The ID of the company to retrieve',
			},

			// ID Parameter - Employee
			{
				displayName: 'Employee ID',
				name: 'employeeId',
				type: 'string',
				required: true,
				displayOptions: {
					show: {
						resource: ['employee'],
						operation: ['get_by_id'],
					},
				},
				default: '',
				description: 'The ID of the employee to retrieve',
			},

			// ID Parameter - Job
			{
				displayName: 'Job ID',
				name: 'jobId',
				type: 'string',
				required: true,
				displayOptions: {
					show: {
						resource: ['job'],
						operation: ['get_by_id'],
					},
				},
				default: '',
				description: 'The ID of the job posting to retrieve',
			},

			// ID Parameter - Post
			{
				displayName: 'Employee Post ID',
				name: 'postId',
				type: 'string',
				required: true,
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['get_by_id'],
					},
				},
				default: '',
				description: 'The ID of the post to retrieve',
			},

			// Shorthand Name Parameter - Employee
			{
				displayName: 'URL Slug',
				name: 'slug',
				type: 'string',
				required: true,
				displayOptions: {
					show: {
						resource: ['employee'],
						operation: ['get_by_slug'],
					},
				},
				default: '',
				placeholder: 'e.g. john-smith',
				description: 'The slug to retrieve data for',
			},

			// Shorthand Name Parameter - Company
			{
				displayName: 'URL Slug',
				name: 'slug',
				type: 'string',
				required: true,
				displayOptions: {
					show: {
						resource: ['company'],
						operation: ['get_by_slug'],
					},
				},
				default: '',
				placeholder: 'e.g. microsoft',
				description: 'The slug to retrieve data for',
			},

			// Website Parameter - Enrich
			{
				displayName: 'Website URL',
				name: 'websiteUrl',
				type: 'string',
				required: true,
				displayOptions: {
					show: {
						resource: ['company'],
						operation: ['enrich'],
					},
				},
				default: '',
				placeholder: 'e.g. https://example.com',
				description: 'The company website URL to enrich data for',
			},

			// Fields Parameter - Employee
			{
				displayName: 'Data Fields (Optional)',
				name: 'fields',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['employee'],
						operation: ['get_by_id', 'get_by_slug'],
					},
				},
				default: '',
				placeholder: 'e.g. full_name,headline',
				description: 'Comma-separated list of fields to return (leave empty for all fields)',
			},

			// Fields Parameter - Company
			{
				displayName: 'Data Fields (Optional)',
				name: 'fields',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['company'],
						operation: ['get_by_id', 'get_by_slug', 'enrich'],
					},
				},
				default: '',
				placeholder: 'e.g. company_name,website',
				description: 'Comma-separated list of fields to return (leave empty for all fields)',
			},

			// Fields Parameter - Jobs
			{
				displayName: 'Data Fields (Optional)',
				name: 'fields',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['job'],
						operation: ['get_by_id'],
					},
				},
				default: '',
				placeholder: 'e.g. title,company_name',
				description: 'Comma-separated list of fields to return (leave empty for all fields)',
			},

			// Fields Parameter - Posts
			{
				displayName: 'Data Fields (Optional)',
				name: 'fields',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['get_by_id'],
					},
				},
				default: '',
				placeholder: 'e.g. url,author_name',
				description: 'Comma-separated list of fields to return (leave empty for all fields)',
			},

			// Elasticsearch DSL Query - Employee
			{
				displayName: 'Elasticsearch DSL Query',
				name: 'esQuery',
				type: 'json',
				required: true,
				displayOptions: {
					show: {
						resource: ['employee'],
						operation: ['search_es_dsl'],
					},
				},
				default: '{"query": {"match_all": {}}}',
				description: 'Elasticsearch DSL query object',
				hint: 'Build your query using a <a href="https://dashboard.coresignal.com/apis/employees/playground" target="_blank">Playground</a>.',
			},

			// Elasticsearch DSL Query - Company
			{
				displayName: 'Elasticsearch DSL Query',
				name: 'esQuery',
				type: 'json',
				required: true,
				displayOptions: {
					show: {
						resource: ['company'],
						operation: ['search_es_dsl'],
					},
				},
				default: '{"query": {"match_all": {}}}',
				description: 'Elasticsearch DSL query object',
				hint: 'Build your query using a <a href="https://dashboard.coresignal.com/apis/company/playground" target="_blank">Playground</a>.',
			},

			// Elasticsearch DSL Query - Job
			{
				displayName: 'Elasticsearch DSL Query',
				name: 'esQuery',
				type: 'json',
				required: true,
				displayOptions: {
					show: {
						resource: ['job'],
						operation: ['search_es_dsl'],
					},
				},
				default: '{"query": {"match_all": {}}}',
				description: 'Elasticsearch DSL query object',
				hint: 'Build your query using a <a href="https://dashboard.coresignal.com/apis/jobs/playground" target="_blank">Playground</a>.',
			},

			// Elasticsearch DSL Query - Post
			{
				displayName: 'Elasticsearch DSL Query',
				name: 'esQuery',
				type: 'json',
				required: true,
				displayOptions: {
					show: {
						resource: ['post'],
						operation: ['search_es_dsl'],
					},
				},
				default: '{"query": {"match_all": {}}}',
				description: 'Elasticsearch DSL query object',
			},

			// Preview Mode (not available for posts)
			{
				displayName: 'Preview Mode',
				name: 'preview',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: {
						resource: ['employee', 'company', 'job'],
						operation: ['search_es_dsl'],
					},
				},
				description:
					'Whether to use the preview endpoint (20 results per page with essential fields, up to 50 pages)',
				hint: 'Preview mode returns essential fields only. Use it for quick testing.',
			},

			// Return All
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: {
						operation: ['search_es_dsl'],
					},
					hide: {
						preview: [true],
					},
				},
				description: 'Whether to return all results or only up to a given limit',
				hint: 'Regular search can return millions of IDs.',
			},

			// Limit - regular search
			{
				displayName: 'Limit',
				name: 'maxResults',
				type: 'number',
				typeOptions: {
					minValue: 1,
				},
				default: 1000,
				displayOptions: {
					show: {
						operation: ['search_es_dsl'],
						returnAll: [false],
					},
					hide: {
						preview: [true],
					},
				},
				description: 'Max number of results to return',
			},

			// Pagination options
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: {
					show: {
						operation: ['search_es_dsl'],
					},
				},
				options: [
					{
						displayName: 'After',
						name: 'after',
						type: 'string',
						default: '',
						displayOptions: {
							hide: {
								'/preview': [true],
							},
						},
						description:
							'Cursor to continue from, taken from the nextPageAfter value of a previous run with Include Pagination Info enabled',
					},
					{
						displayName: 'Include Pagination Info',
						name: 'includePaginationInfo',
						type: 'boolean',
						default: false,
						description:
							'Whether to return a single item holding all results together with pagination details (total results, next page, snapshot ID)',
					},
					{
						displayName: 'Page',
						name: 'page',
						type: 'number',
						typeOptions: {
							minValue: 1,
							maxValue: 50,
						},
						default: 1,
						displayOptions: {
							show: {
								'/preview': [true],
							},
						},
						description: 'Preview page to fetch',
					},
					{
						displayName: 'Snapshot',
						name: 'snapshot',
						type: 'boolean',
						default: false,
						displayOptions: {
							show: {
								'/preview': [true],
							},
						},
						description:
							'Whether to open a snapshot so later pages stay consistent. The API only accepts it on page 1 and the snapshot expires after 300 seconds. Enable Include Pagination Info to receive the snapshot ID.',
					},
					{
						displayName: 'Snapshot ID',
						name: 'snapshotId',
						type: 'string',
						default: '',
						displayOptions: {
							show: {
								'/preview': [true],
							},
						},
						description: 'Snapshot ID from a previous run that keeps preview pages consistent',
					},
				],
			},

		],
		usableAsTool: true,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const dataset = 'multi_source'; // Always use multi_source
				const operation = this.getNodeParameter('operation', i) as string;
				const credentials = await this.getCredentials('coresignalApi');
				const baseUrl = credentials.baseUrl as string;

				let url = '';
				const qs: IDataObject = {};

				// Build the data source string (e.g., "company_multi_source", "employee_multi_source")
				// Posts use a different endpoint structure
				const dataSource = resource === 'post' ? 'employee_post' : `${resource}_${dataset}`;
				const baseEndpoint = `/cdapi/v2/${dataSource}`;

				switch (operation) {
					case 'get_by_id': {
						let id: string;
						if (resource === 'company') {
							id = this.getNodeParameter('companyId', i) as string;
						} else if (resource === 'employee') {
							id = this.getNodeParameter('employeeId', i) as string;
						} else if (resource === 'job') {
							id = this.getNodeParameter('jobId', i) as string;
						} else {
							id = this.getNodeParameter('postId', i) as string;
						}
						url = `${baseEndpoint}/collect/${id}`;

						const fields = this.getNodeParameter('fields', i, '') as string;
						if (fields) {
							qs.fields = fields.split(',').map(f => f.trim());
						}
						break;
					}

					case 'get_by_slug': {
						const slug = this.getNodeParameter('slug', i) as string;
						url = `${baseEndpoint}/collect/${encodeURIComponent(slug)}`;

						const fields = this.getNodeParameter('fields', i, '') as string;
						if (fields) {
							qs.fields = fields.split(',').map(f => f.trim());
						}
						break;
					}

					case 'enrich': {
						const websiteUrl = this.getNodeParameter('websiteUrl', i) as string;
						url = `${baseEndpoint}/enrich`;
						qs.website = websiteUrl;

						const fields = this.getNodeParameter('fields', i, '') as string;
						if (fields) {
							qs.fields = fields.split(',').map(f => f.trim());
						}
						break;
					}

					case 'search_es_dsl': {
						const searchResults = await runSearch(this, i, `${baseUrl}${baseEndpoint}`);
						returnData.push(
							...this.helpers.constructExecutionMetaData(
								this.helpers.returnJsonArray(searchResults as IDataObject[]),
								{
									itemData: { item: i },
								},
							),
						);
						continue;
					}
				}

				const requestOptions: IHttpRequestOptions = {
					method: 'GET',
					url: `${baseUrl}${url}`,
					headers: {
						'Accept': 'application/json',
						'Content-Type': 'application/json',
					},
					arrayFormat: 'repeat',
				};

				if (Object.keys(qs).length > 0) {
					requestOptions.qs = qs;
				}

				const responseData = await this.helpers.httpRequestWithAuthentication.call(
					this,
					'coresignalApi',
					requestOptions,
				);

				// Handle both single objects and arrays from API
				const responseItems = Array.isArray(responseData) ? responseData : [responseData];

				const executionData = this.helpers.constructExecutionMetaData(
					this.helpers.returnJsonArray(responseItems as IDataObject[]),
					{ itemData: { item: i } },
				);

				returnData.push(...executionData);
			} catch (error) {
				if (this.continueOnFail()) {
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					returnData.push({ json: { error: errorMessage }, pairedItem: { item: i } });
					continue;
				}
				throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
