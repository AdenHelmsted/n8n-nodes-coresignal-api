# n8n-nodes-coresignal-api

This is an [n8n](https://n8n.io/) community node for the [Coresignal API](https://coresignal.com/). It provides access to company, employee, job posting, and employee post data from Coresignal's multi-source datasets, and Agentic Search that turns natural language prompts into search queries.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Usage](#usage)
[Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

## Operations

### Agentic Search

- **Fast Search** - Turn a prompt into an Elasticsearch DSL query for a chosen entity, with rapid responses at minimal cost
- **Reasoning Search** - Turn a prompt into an Elasticsearch DSL query, with highly accurate results even for complex prompts

### Company Data

- **Collect by ID** - Retrieve a full company profile using a company ID
- **Collect by slug** - Retrieve a full company profile using a URL slug
- **Enrich by website** - Enrich company data using a website URL
- **Search with Elasticsearch DSL** - Search companies using an Elasticsearch DSL query

### Employee Data

- **Collect by ID** - Retrieve a full employee profile using an employee ID
- **Collect by slug** - Retrieve a full employee profile using a URL slug
- **Search with Elasticsearch DSL** - Search employees using an Elasticsearch DSL query

### Job Data

- **Collect by ID** - Retrieve a full job posting using a job ID
- **Search with Elasticsearch DSL** - Search jobs using an Elasticsearch DSL query

### Employee Posts

- **Collect by ID** - Retrieve a full employee post using a post ID
- **Search with Elasticsearch DSL** - Search employee posts using an Elasticsearch DSL query

## Credentials

To use this node, you need a Coresignal API key.

1. Sign up at [Coresignal](https://coresignal.com/) and obtain an API key
2. In n8n, go to **Credentials** > **Add Credential** > **Coresignal API**
3. Enter your API key
4. The default Base URL is `https://api.coresignal.com` (change only if instructed by Coresignal)

## Usage

### Collect by ID

Select a category (Company, Employee, Job, or Post), choose "Collect by ID", and enter the entity ID. Optionally specify fields to return only specific data.

### Collect by slug

Available for Company and Employee categories. Enter the URL slug (e.g., `microsoft` for a company or `john-smith` for an employee).

### Enrich by website

Available for the Company category. Enter a company website URL to enrich with Coresignal data.

### Search with Elasticsearch DSL

Use an Elasticsearch DSL query to search across any category. Regular search returns matching IDs and can page through all of them across runs. Enable **Preview mode** for quick testing (20 records per page with essential fields only).

Build your queries using the Coresignal Playground:
- [Employee Playground](https://dashboard.coresignal.com/apis/employees/playground)
- [Company Playground](https://dashboard.coresignal.com/apis/company/playground)
- [Jobs Playground](https://dashboard.coresignal.com/apis/jobs/playground)

### Agentic Search

Turn a natural language **Prompt** into an Elasticsearch DSL query with **Fast Search** or **Reasoning Search**. The output is one item with the generated query, the entity it targets and, with **Return Data** on, a preview of up to 20 matching records.

To fetch all matching IDs, use the query in **Search with Elasticsearch DSL** on the matching category.

## Resources

- [Coresignal API Documentation](https://docs.coresignal.com/)
- [n8n Community Nodes Documentation](https://docs.n8n.io/integrations/community-nodes/)
