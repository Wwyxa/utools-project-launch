[GitHub Docs](/en)

Search or ask Copilot

Select language: current language is English

Search or ask Copilot

Open menu

Collapse sidebarExpand sidebar

Scroll breadcrumbs leftScroll breadcrumbs right

# Running variations of jobs in a workflow

Create a matrix to define variations for each job.

## In this article

* [About matrix strategies](#about-matrix-strategies)
* [Adding a matrix strategy to your workflow job](#adding-a-matrix-strategy-to-your-workflow-job)
* [Using contexts to create matrices](#using-contexts-to-create-matrices)
* [Expanding or adding matrix configurations](#expanding-or-adding-matrix-configurations)
* [Excluding matrix configurations](#excluding-matrix-configurations)
* [Using an output to define two matrices](#using-an-output-to-define-two-matrices)
* [Handling failures](#handling-failures)
* [Defining the maximum number of concurrent jobs](#defining-the-maximum-number-of-concurrent-jobs)

## [About matrix strategies](#about-matrix-strategies)

A matrix strategy lets you use variables in a single job definition to automatically create multiple job runs that are based on the combinations of the variables. For example, you can use a matrix strategy to test your code in multiple versions of a language or on multiple operating systems.

## [Adding a matrix strategy to your workflow job](#adding-a-matrix-strategy-to-your-workflow-job)

Use `jobs..strategy.matrix` to define a matrix of different job configurations. Within your matrix, define one or more variables followed by an array of values. For example, the following matrix has a variable called `version` with the value `[10, 12, 14]` and a variable called `os` with the value `[ubuntu-latest, windows-latest]`:

```
jobs:example_matrix:strategy:matrix:version: 10 12 14os:ubuntu-latestwindows-latest
```

A job will run for each possible combination of the variables. In this example, the workflow will run six jobs, one for each combination of the `os` and `version` variables.

The above matrix will create the jobs in the following order.

* `{version: 10, os: ubuntu-latest}`
* `{version: 10, os: windows-latest}`
* `{version: 12, os: ubuntu-latest}`
* `{version: 12, os: windows-latest}`
* `{version: 14, os: ubuntu-latest}`
* `{version: 14, os: windows-latest}`

For reference information and examples, see [Workflow syntax for GitHub Actions](/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstrategymatrix).

## [Using contexts to create matrices](#using-contexts-to-create-matrices)

To create matrices with information about workflow runs, variables, runner environments, jobs, and steps, access contexts using the `${{  }}` expression syntax. For more information about contexts, see [Contexts reference](/en/actions/reference/workflows-and-actions/contexts).

For example, the following workflow triggers on the `repository_dispatch` event and uses information from the event payload to build the matrix. When a repository dispatch event is created with a payload like the one below, the matrix `version` variable will have a value of `[12, 14, 16]`. For more information about the `repository_dispatch` trigger, see [Events that trigger workflows](/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#repository_dispatch).

```
{"event_type": "test", "client_payload":{"versions":[12, 14, 16]}}
```

```
on:repository_dispatch:types: - testjobs:example_matrix:runs-on:ubuntu-lateststrategy:matrix:version:${{github.event.client_payload.versions}}steps: -uses:actions/setup-node@v7with:node-version:${{matrix.version}}
```

## [Expanding or adding matrix configurations](#expanding-or-adding-matrix-configurations)

To expand existing matrix configurations or to add new configurations, use `jobs..strategy.matrix.include`. The value of `include` is a list of objects.

For example, consider the following matrix.

```
strategy:matrix:fruit: apple pearanimal: cat doginclude: -color: green -color: pinkanimal: cat -fruit: appleshape: circle -fruit: banana -fruit: bananaanimal: cat
```

This will result in six jobs with the following matrix combinations.

* `{fruit: apple, animal: cat, color: pink, shape: circle}`
* `{fruit: apple, animal: dog, color: green, shape: circle}`
* `{fruit: pear, animal: cat, color: pink}`
* `{fruit: pear, animal: dog, color: green}`
* `{fruit: banana}`
* `{fruit: banana, animal: cat}`

Each `include` entry was applied in the following ways.

* `{color: green}` is added to all of the original matrix combinations because it can be added without overwriting any part of the original combinations.
* `{color: pink, animal: cat}` adds `color:pink` only to the original matrix combinations that include `animal: cat`. This overwrites the `color: green` that was added by the previous `include` entry.
* `{fruit: apple, shape: circle}` adds `shape: circle` only to the original matrix combinations that include `fruit: apple`.
* `{fruit: banana}` cannot be added to any original matrix combination without overwriting a value, so it is added as an additional matrix combination.
* `{fruit: banana, animal: cat}` cannot be added to any original matrix combination without overwriting a value, so it is added as an additional matrix combination. It does not add to the `{fruit: banana}` matrix combination because that combination was not one of the original matrix combinations.

For reference and example configurations, see [Workflow syntax for GitHub Actions](/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstrategymatrixinclude).

## [Excluding matrix configurations](#excluding-matrix-configurations)

To remove specific configurations defined in the matrix, use `jobs..strategy.matrix.exclude`.

For example, the following workflow will run nine jobs: one job for each of the 12 configurations, minus the one excluded job that matches `{os: macos-latest, version: 12, environment: production}`, and the two excluded jobs that match `{os: windows-latest, version: 16}`.

```
strategy:matrix:os:macos-latestwindows-latestversion: 12 14 16environment: staging productionexclude: -os:macos-latestversion: 12environment: production -os:windows-latestversion: 16runs-on:${{matrix.os}}
```

For reference information, see [Workflow syntax for GitHub Actions](/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstrategymatrixexclude)

## [Using an output to define two matrices](#using-an-output-to-define-two-matrices)

You can use the output from one job to define matrices for multiple jobs.

For example, the following workflow demonstrates how to define a matrix of values in one job, use that matrix in a second jobs to produce artifacts, and then consume those artifacts in a third job. Each artifact is associated with a value from the matrix.

YAML

```
name: shared matrix on: push: workflow_dispatch: jobs: define-matrix: runs-on: ubuntu-latest outputs: colors: ${{ steps.colors.outputs.colors }} steps: - name: Define Colors id: colors run: | echo 'colors=["red", "green", "blue"]' >> "$GITHUB_OUTPUT" produce-artifacts: runs-on: ubuntu-latest needs: define-matrix strategy: matrix: color: ${{ fromJSON(needs.define-matrix.outputs.colors) }} steps: - name: Define Color env: color: ${{ matrix.color }} run: | echo "$color" > color - name: Produce Artifact uses: actions/upload-artifact@v4 with: name: ${{ matrix.color }} path: color consume-artifacts: runs-on: ubuntu-latest needs: - define-matrix - produce-artifacts strategy: matrix: color: ${{ fromJSON(needs.define-matrix.outputs.colors) }} steps: - name: Retrieve Artifact uses: actions/download-artifact@v5 with: name: ${{ matrix.color }} - name: Report Color run: | cat color 
```

```
name: shared matrixon:push:workflow_dispatch:jobs:define-matrix:runs-on:ubuntu-latestoutputs:colors:${{steps.colors.outputs.colors}}steps: -name: Define Colorsid: colorsrun:| echo 'colors=["red", "green", "blue"]' >> "$GITHUB_OUTPUT" produce-artifacts:runs-on:ubuntu-latestneeds:define-matrixstrategy:matrix:color:${{fromJSON(needs.define-matrix.outputs.colors)}}steps: -name: Define Colorenv:color:${{matrix.color}}run:| echo "$color" > color -name: Produce Artifactuses:actions/upload-artifact@v4with:name:${{matrix.color}}path: colorconsume-artifacts:runs-on:ubuntu-latestneeds: -define-matrix -produce-artifactsstrategy:matrix:color:${{fromJSON(needs.define-matrix.outputs.colors)}}steps: -name: Retrieve Artifactuses:actions/download-artifact@v5with:name:${{matrix.color}} -name: Report Colorrun: | cat color 
```

## [Handling failures](#handling-failures)

To control how job failures are handled, use `jobs..strategy.fail-fast` and `jobs..continue-on-error`.

You can use `jobs..strategy.fail-fast` and `jobs..continue-on-error` together. For example, the following workflow will start four jobs. For each job, `continue-on-error` is determined by the value of `matrix.experimental`. If any of the jobs with `continue-on-error: false` fail, all jobs that are in progress or queued will be cancelled. If the job with `continue-on-error: true` fails, the other jobs will not be affected.

```
jobs:test:runs-on:ubuntu-latestcontinue-on-error:${{matrix.experimental}}strategy:fail-fast: truematrix:version: 6 7 8experimental: falseinclude: -version: 9experimental: true
```

For reference information see [`jobs..strategy.fail-fast`](/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstrategyfail-fast) and [`jobs..continue-on-error`](/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idcontinue-on-error).

## [Defining the maximum number of concurrent jobs](#defining-the-maximum-number-of-concurrent-jobs)

To set the maximum number of jobs that can run simultaneously when using a `matrix` job strategy, use `jobs..strategy.max-parallel`.

For example, the following workflow will run a maximum of two jobs at a time, even if there are runners available to run all six jobs at once.

```
jobs:example_matrix:strategy:max-parallel: 2matrix:version: 10 12 14os:ubuntu-latestwindows-latest
```

For reference information, see [Workflow syntax for GitHub Actions](/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstrategymax-parallel).
