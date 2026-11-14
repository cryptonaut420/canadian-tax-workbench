#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v dotnet >/dev/null; then
    echo 'Native .NET 10 SDK is required for this development build. Wine is not used.' >&2
    exit 2
fi
dotnet run --project "$project_dir/native-engine/NativeTax.csproj" -- doctor
