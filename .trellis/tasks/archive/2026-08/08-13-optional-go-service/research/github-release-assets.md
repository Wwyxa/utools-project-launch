[GitHub Docs](/en)

Search or ask Copilot

Select language: current language is English

Search or ask Copilot

Open menu

Collapse sidebarExpand sidebar

Scroll breadcrumbs leftScroll breadcrumbs right

The REST API is now versioned. For more information, see "[About API versioning](/rest/overview/api-versions)."

# REST API endpoints for release assets

Use the REST API to manage release assets.

## [Get a release asset](#get-a-release-asset)

To download the asset's binary content:

* If within a browser, fetch the location specified in the `browser_download_url` key provided in the response.
* Alternatively, set the `Accept` header of the request to [`application/octet-stream`](https://docs.github.com/rest/using-the-rest-api/getting-started-with-the-rest-api#media-types). The API will either redirect the client to the location, or stream it directly if possible. API clients should handle both a `200` or `302` response.

### [Fine-grained access tokens for "Get a release asset"](#get-a-release-asset--fine-grained-access-tokens)

This endpoint works with the following fine-grained token types:

* [GitHub App user access tokens](/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
* [GitHub App installation access tokens](/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
* [Fine-grained personal access tokens](/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token)

The fine-grained token must have the following permission set:

* "Contents" repository permissions (read)

This endpoint can be used without authentication or the aforementioned permissions if only public resources are requested.

### [Parameters for "Get a release asset"](#get-a-release-asset--parameters)

Headers

| Name, Type, Description |
| `accept` string  Setting to `application/vnd.github+json` is recommended. |

Path parameters

| Name, Type, Description |
| `owner` string Required  The account owner of the repository. The name is not case sensitive. |
| `repo` string Required  The name of the repository without the `.git` extension. The name is not case sensitive. |
| `asset_id` integer Required  The unique identifier of the asset. |

### [HTTP response status codes for "Get a release asset"](#get-a-release-asset--status-codes)

| Status code | Description |
| --- | --- |
| `200` | OK |
| `302` | Found |
| `404` | Resource not found |

### [Code samples for "Get a release asset"](#get-a-release-asset--code-samples)

#### Request example

get/repos/{owner}/{repo}/releases/assets/{asset\_id}

Copy to clipboard curl request example

`curl -L \ -H "Accept: application/vnd.github+json" \ -H "Authorization: Bearer " \ -H "X-GitHub-Api-Version: 2026-03-10" \ https://api.github.com/repos/OWNER/REPO/releases/assets/ASSET_ID`

Response

`Status: 200`

`{ "url": "https://api.github.com/repos/octocat/Hello-World/releases/assets/1", "browser_download_url": "https://github.com/octocat/Hello-World/releases/download/v1.0.0/example.zip", "id": 1, "node_id": "MDEyOlJlbGVhc2VBc3NldDE=", "name": "example.zip", "label": "short description", "state": "uploaded", "content_type": "application/zip", "size": 1024, "digest": "sha256:2151b604e3429bff440b9fbc03eb3617bc2603cda96c95b9bb05277f9ddba255", "download_count": 42, "created_at": "2013-02-27T19:35:32Z", "updated_at": "2013-02-27T19:35:32Z", "uploader": { "login": "octocat", "id": 1, "node_id": "MDQ6VXNlcjE=", "avatar_url": "https://github.com/images/error/octocat_happy.gif", "gravatar_id": "", "url": "https://api.github.com/users/octocat", "html_url": "https://github.com/octocat", "followers_url": "https://api.github.com/users/octocat/followers", "following_url": "https://api.github.com/users/octocat/following{/other_user}", "gists_url": "https://api.github.com/users/octocat/gists{/gist_id}", "starred_url": "https://api.github.com/users/octocat/starred{/owner}{/repo}", "subscriptions_url": "https://api.github.com/users/octocat/subscriptions", "organizations_url": "https://api.github.com/users/octocat/orgs", "repos_url": "https://api.github.com/users/octocat/repos", "events_url": "https://api.github.com/users/octocat/events{/privacy}", "received_events_url": "https://api.github.com/users/octocat/received_events", "type": "User", "site_admin": false } }`

## [Update a release asset](#update-a-release-asset)

Users with push access to the repository can edit a release asset.

### [Fine-grained access tokens for "Update a release asset"](#update-a-release-asset--fine-grained-access-tokens)

This endpoint works with the following fine-grained token types:

* [GitHub App user access tokens](/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
* [GitHub App installation access tokens](/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
* [Fine-grained personal access tokens](/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token)

The fine-grained token must have the following permission set:

* "Contents" repository permissions (write)

### [Parameters for "Update a release asset"](#update-a-release-asset--parameters)

Headers

| Name, Type, Description |
| `accept` string  Setting to `application/vnd.github+json` is recommended. |

Path parameters

| Name, Type, Description |
| `owner` string Required  The account owner of the repository. The name is not case sensitive. |
| `repo` string Required  The name of the repository without the `.git` extension. The name is not case sensitive. |
| `asset_id` integer Required  The unique identifier of the asset. |

Body parameters

| Name, Type, Description |
| `name` string  The file name of the asset. |
| `label` string  An alternate short description of the asset. Used in place of the filename. |
| `state` string |

### [HTTP response status codes for "Update a release asset"](#update-a-release-asset--status-codes)

| Status code | Description |
| --- | --- |
| `200` | OK |

### [Code samples for "Update a release asset"](#update-a-release-asset--code-samples)

#### Request example

patch/repos/{owner}/{repo}/releases/assets/{asset\_id}

Copy to clipboard curl request example

`curl -L \ -X PATCH \ -H "Accept: application/vnd.github+json" \ -H "Authorization: Bearer " \ -H "X-GitHub-Api-Version: 2026-03-10" \ https://api.github.com/repos/OWNER/REPO/releases/assets/ASSET_ID \ -d '{"name":"foo-1.0.0-osx.zip","label":"Mac binary"}'`

Response

`Status: 200`

`{ "url": "https://api.github.com/repos/octocat/Hello-World/releases/assets/1", "browser_download_url": "https://github.com/octocat/Hello-World/releases/download/v1.0.0/example.zip", "id": 1, "node_id": "MDEyOlJlbGVhc2VBc3NldDE=", "name": "example.zip", "label": "short description", "state": "uploaded", "content_type": "application/zip", "size": 1024, "digest": "sha256:2151b604e3429bff440b9fbc03eb3617bc2603cda96c95b9bb05277f9ddba255", "download_count": 42, "created_at": "2013-02-27T19:35:32Z", "updated_at": "2013-02-27T19:35:32Z", "uploader": { "login": "octocat", "id": 1, "node_id": "MDQ6VXNlcjE=", "avatar_url": "https://github.com/images/error/octocat_happy.gif", "gravatar_id": "", "url": "https://api.github.com/users/octocat", "html_url": "https://github.com/octocat", "followers_url": "https://api.github.com/users/octocat/followers", "following_url": "https://api.github.com/users/octocat/following{/other_user}", "gists_url": "https://api.github.com/users/octocat/gists{/gist_id}", "starred_url": "https://api.github.com/users/octocat/starred{/owner}{/repo}", "subscriptions_url": "https://api.github.com/users/octocat/subscriptions", "organizations_url": "https://api.github.com/users/octocat/orgs", "repos_url": "https://api.github.com/users/octocat/repos", "events_url": "https://api.github.com/users/octocat/events{/privacy}", "received_events_url": "https://api.github.com/users/octocat/received_events", "type": "User", "site_admin": false } }`

## [Delete a release asset](#delete-a-release-asset)

### [Fine-grained access tokens for "Delete a release asset"](#delete-a-release-asset--fine-grained-access-tokens)

This endpoint works with the following fine-grained token types:

* [GitHub App user access tokens](/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
* [GitHub App installation access tokens](/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
* [Fine-grained personal access tokens](/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token)

The fine-grained token must have the following permission set:

* "Contents" repository permissions (write)

### [Parameters for "Delete a release asset"](#delete-a-release-asset--parameters)

Headers

| Name, Type, Description |
| `accept` string  Setting to `application/vnd.github+json` is recommended. |

Path parameters

| Name, Type, Description |
| `owner` string Required  The account owner of the repository. The name is not case sensitive. |
| `repo` string Required  The name of the repository without the `.git` extension. The name is not case sensitive. |
| `asset_id` integer Required  The unique identifier of the asset. |

### [HTTP response status codes for "Delete a release asset"](#delete-a-release-asset--status-codes)

| Status code | Description |
| --- | --- |
| `204` | No Content |
| `404` | Resource not found |

### [Code samples for "Delete a release asset"](#delete-a-release-asset--code-samples)

#### Request example

delete/repos/{owner}/{repo}/releases/assets/{asset\_id}

Copy to clipboard curl request example

`curl -L \ -X DELETE \ -H "Accept: application/vnd.github+json" \ -H "Authorization: Bearer " \ -H "X-GitHub-Api-Version: 2026-03-10" \ https://api.github.com/repos/OWNER/REPO/releases/assets/ASSET_ID`

Response

`Status: 204`

## [List release assets](#list-release-assets)

### [Fine-grained access tokens for "List release assets"](#list-release-assets--fine-grained-access-tokens)

This endpoint works with the following fine-grained token types:

* [GitHub App user access tokens](/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
* [GitHub App installation access tokens](/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
* [Fine-grained personal access tokens](/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token)

The fine-grained token must have the following permission set:

* "Contents" repository permissions (read)

This endpoint can be used without authentication or the aforementioned permissions if only public resources are requested.

### [Parameters for "List release assets"](#list-release-assets--parameters)

Headers

| Name, Type, Description |
| `accept` string  Setting to `application/vnd.github+json` is recommended. |

Path parameters

| Name, Type, Description |
| `owner` string Required  The account owner of the repository. The name is not case sensitive. |
| `repo` string Required  The name of the repository without the `.git` extension. The name is not case sensitive. |
| `release_id` integer Required  The unique identifier of the release. |

Query parameters

| Name, Type, Description |
| `per_page` integer  The number of results per page (max 100). For more information, see "[Using pagination in the REST API](https://docs.github.com/rest/using-the-rest-api/using-pagination-in-the-rest-api)."  Default: `30` |
| `page` integer  The page number of the results to fetch. For more information, see "[Using pagination in the REST API](https://docs.github.com/rest/using-the-rest-api/using-pagination-in-the-rest-api)."  Default: `1` |

### [HTTP response status codes for "List release assets"](#list-release-assets--status-codes)

| Status code | Description |
| --- | --- |
| `200` | OK |

### [Code samples for "List release assets"](#list-release-assets--code-samples)

#### Request example

get/repos/{owner}/{repo}/releases/{release\_id}/assets

Copy to clipboard curl request example

`curl -L \ -H "Accept: application/vnd.github+json" \ -H "Authorization: Bearer " \ -H "X-GitHub-Api-Version: 2026-03-10" \ https://api.github.com/repos/OWNER/REPO/releases/RELEASE_ID/assets`

Response

`Status: 200`

`[ { "url": "https://api.github.com/repos/octocat/Hello-World/releases/assets/1", "browser_download_url": "https://github.com/octocat/Hello-World/releases/download/v1.0.0/example.zip", "id": 1, "node_id": "MDEyOlJlbGVhc2VBc3NldDE=", "name": "example.zip", "label": "short description", "state": "uploaded", "content_type": "application/zip", "size": 1024, "digest": "sha256:2151b604e3429bff440b9fbc03eb3617bc2603cda96c95b9bb05277f9ddba255", "download_count": 42, "created_at": "2013-02-27T19:35:32Z", "updated_at": "2013-02-27T19:35:32Z", "uploader": { "login": "octocat", "id": 1, "node_id": "MDQ6VXNlcjE=", "avatar_url": "https://github.com/images/error/octocat_happy.gif", "gravatar_id": "", "url": "https://api.github.com/users/octocat", "html_url": "https://github.com/octocat", "followers_url": "https://api.github.com/users/octocat/followers", "following_url": "https://api.github.com/users/octocat/following{/other_user}", "gists_url": "https://api.github.com/users/octocat/gists{/gist_id}", "starred_url": "https://api.github.com/users/octocat/starred{/owner}{/repo}", "subscriptions_url": "https://api.github.com/users/octocat/subscriptions", "organizations_url": "https://api.github.com/users/octocat/orgs", "repos_url": "https://api.github.com/users/octocat/repos", "events_url": "https://api.github.com/users/octocat/events{/privacy}", "received_events_url": "https://api.github.com/users/octocat/received_events", "type": "User", "site_admin": false } } ]`

## [Upload a release asset](#upload-a-release-asset)

This endpoint makes use of a [Hypermedia relation](https://docs.github.com/rest/using-the-rest-api/getting-started-with-the-rest-api#hypermedia) to determine which URL to access. The endpoint you call to upload release assets is specific to your release. Use the `upload_url` returned in the response of the [Create a release endpoint](https://docs.github.com/rest/releases/releases#create-a-release) to upload a release asset.

You need to use an HTTP client which supports [SNI](http://en.wikipedia.org/wiki/Server_Name_Indication) to make calls to this endpoint.

Most libraries will set the required `Content-Length` header automatically. Use the required `Content-Type` header to provide the media type of the asset. For a list of media types, see [Media Types](https://www.iana.org/assignments/media-types/media-types.xhtml). For example:

GitHub expects the asset data in its raw binary form, rather than JSON. You will send the raw binary content of the asset as the request body. Everything else about the endpoint is the same as the rest of the API. For example, you'll still need to pass your authentication to be able to upload an asset.

When an upstream failure occurs, you will receive a `502 Bad Gateway` status. This may leave an empty asset with a state of `starter`. It can be safely deleted.

* GitHub renames asset filenames that have special characters, non-alphanumeric characters, and leading or trailing periods. The "[List release assets](https://docs.github.com/rest/releases/assets#list-release-assets)" endpoint lists the renamed filenames. For more information and help, contact [GitHub Support](https://support.github.com/contact?tags=dotcom-rest-api).
* To find the `release_id` query the [`GET /repos/{owner}/{repo}/releases/latest` endpoint](https://docs.github.com/rest/releases/releases#get-the-latest-release).
* If you upload an asset with the same filename as another uploaded asset, you'll receive an error and must delete the old file before you can re-upload the new asset.

### [Parameters for "Upload a release asset"](#upload-a-release-asset--parameters)

Headers

| Name, Type, Description |
| `accept` string  Setting to `application/vnd.github+json` is recommended. |

Path parameters

| Name, Type, Description |
| `owner` string Required  The account owner of the repository. The name is not case sensitive. |
| `repo` string Required  The name of the repository without the `.git` extension. The name is not case sensitive. |
| `release_id` integer Required  The unique identifier of the release. |

Query parameters

| Name, Type, Description |
| `name` string Required |
| `label` string |

### [HTTP response status codes for "Upload a release asset"](#upload-a-release-asset--status-codes)

| Status code | Description |
| --- | --- |
| `201` | Response for successful upload |
| `422` | Response if you upload an asset with the same filename as another uploaded asset |

### [Code samples for "Upload a release asset"](#upload-a-release-asset--code-samples)

#### Request example

post/repos/{owner}/{repo}/releases/{release\_id}/assets

Copy to clipboard curl request example

`curl -L \ -X POST \ -H "Accept: application/vnd.github+json" \ -H "Authorization: Bearer " \ -H "X-GitHub-Api-Version: 2026-03-10" \ -H "Content-Type: application/octet-stream" \ "https://uploads.github.com/repos/OWNER/REPO/releases/RELEASE_ID/assets?name=example.zip" \ --data-binary "@example.zip"`

Response for successful upload

`Status: 201`

`{ "url": "https://api.github.com/repos/octocat/Hello-World/releases/assets/1", "browser_download_url": "https://github.com/octocat/Hello-World/releases/download/v1.0.0/example.zip", "id": 1, "node_id": "MDEyOlJlbGVhc2VBc3NldDE=", "name": "example.zip", "label": "short description", "state": "uploaded", "content_type": "application/zip", "size": 1024, "digest": "sha256:2151b604e3429bff440b9fbc03eb3617bc2603cda96c95b9bb05277f9ddba255", "download_count": 42, "created_at": "2013-02-27T19:35:32Z", "updated_at": "2013-02-27T19:35:32Z", "uploader": { "login": "octocat", "id": 1, "node_id": "MDQ6VXNlcjE=", "avatar_url": "https://github.com/images/error/octocat_happy.gif", "gravatar_id": "", "url": "https://api.github.com/users/octocat", "html_url": "https://github.com/octocat", "followers_url": "https://api.github.com/users/octocat/followers", "following_url": "https://api.github.com/users/octocat/following{/other_user}", "gists_url": "https://api.github.com/users/octocat/gists{/gist_id}", "starred_url": "https://api.github.com/users/octocat/starred{/owner}{/repo}", "subscriptions_url": "https://api.github.com/users/octocat/subscriptions", "organizations_url": "https://api.github.com/users/octocat/orgs", "repos_url": "https://api.github.com/users/octocat/repos", "events_url": "https://api.github.com/users/octocat/events{/privacy}", "received_events_url": "https://api.github.com/users/octocat/received_events", "type": "User", "site_admin": false } }`
