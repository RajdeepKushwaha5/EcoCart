"""Publish the website with AWS Amplify Hosting.

Run after `sam deploy`:
    AWS_PROFILE=ecocart python scripts/deploy_site.py

The Amplify app is created on the first run and reused after that. The site gets the API
address, the shared plant drawing, the icons, and a zip of the extension to download.
"""

import argparse
import io
import json
import shutil
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path

import boto3

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
EXTENSION = ROOT / "extension"
SKIP_IN_EXTENSION_ZIP = {"tests"}
APP_NAME = "ecocart-india-site"
BRANCH = "main"


def stack_outputs(stack_name, region):
    client = boto3.client("cloudformation", region_name=region)
    stack = client.describe_stacks(StackName=stack_name)["Stacks"][0]
    return {output["OutputKey"]: output["OutputValue"] for output in stack.get("Outputs", [])}


def build(target, api_url):
    shutil.copytree(SITE, target, dirs_exist_ok=True)
    shutil.copy(EXTENSION / "ui" / "plant.js", target / "plant.js")
    shutil.copytree(EXTENSION / "icons", target / "icons", dirs_exist_ok=True)
    (target / "config.js").write_text(f"window.ECOCART_API = {json.dumps(api_url)};\n", encoding="utf-8")
    with zipfile.ZipFile(target / "ecocart-extension.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(EXTENSION.rglob("*")):
            relative = path.relative_to(EXTENSION)
            if path.is_file() and relative.parts[0] not in SKIP_IN_EXTENSION_ZIP:
                archive.write(path, Path("ecocart-extension") / relative)


def zip_folder(folder):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(folder.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(folder).as_posix())
    return buffer.getvalue()


def amplify_app(amplify):
    for app in amplify.list_apps(maxResults=100)["apps"]:
        if app["name"] == APP_NAME:
            return app["appId"], app["defaultDomain"]
    app = amplify.create_app(name=APP_NAME, platform="WEB")["app"]
    amplify.create_branch(appId=app["appId"], branchName=BRANCH, stage="PRODUCTION")
    return app["appId"], app["defaultDomain"]


def publish(amplify, app_id, archive):
    deployment = amplify.create_deployment(appId=app_id, branchName=BRANCH)
    request = urllib.request.Request(deployment["zipUploadUrl"], data=archive, method="PUT",
                                     headers={"Content-Type": "application/zip"})
    with urllib.request.urlopen(request, timeout=120):
        pass
    job_id = deployment["jobId"]
    amplify.start_deployment(appId=app_id, branchName=BRANCH, jobId=job_id)
    while True:
        status = amplify.get_job(appId=app_id, branchName=BRANCH, jobId=job_id)["job"]["summary"]["status"]
        if status in {"SUCCEED", "FAILED", "CANCELLED"}:
            return status
        time.sleep(5)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--stack-name", default="ecocart-india")
    parser.add_argument("--region", default="ap-south-1")
    args = parser.parse_args()

    api_url = stack_outputs(args.stack_name, args.region)["ApiUrl"]
    with tempfile.TemporaryDirectory() as folder:
        target = Path(folder)
        build(target, api_url)
        archive = zip_folder(target)

    amplify = boto3.client("amplify", region_name=args.region)
    app_id, domain = amplify_app(amplify)
    status = publish(amplify, app_id, archive)
    print(f"Deployment {status}: https://{BRANCH}.{domain}")
    if status != "SUCCEED":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
