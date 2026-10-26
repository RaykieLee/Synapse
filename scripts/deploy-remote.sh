#!/usr/bin/env bash
set -Eeuo pipefail

release_dir="${1:?release directory is required}"
image_tag="${2:?image tag is required}"
base_dir="/opt/synapse"
state_dir="${base_dir}/state"
current_env="${state_dir}/current.env"
previous_env="${state_dir}/previous.env"
new_env="${state_dir}/release-${image_tag}.env"
compose_files=(-f "${base_dir}/docker-compose.yml")
compose=(
  docker compose
  --project-directory "${base_dir}"
  --env-file "${base_dir}/.env.docker"
  --env-file "${new_env}"
)

if [[ ! -r "${base_dir}/.env.docker" ]]; then
  echo "Missing ${base_dir}/.env.docker" >&2
  exit 1
fi
if [[ ! -r "${release_dir}/synapse-images.tar.gz" ]]; then
  echo "Missing image bundle in ${release_dir}" >&2
  exit 1
fi

mkdir -p "${state_dir}"
if [[ -s "${current_env}" ]]; then
  cp "${current_env}" "${previous_env}"
fi

cp "${release_dir}/docker-compose.deploy-host.yml" "${base_dir}/docker-compose.yml"
cp "${release_dir}/release.env" "${new_env}"

echo "Loading release images ${image_tag}"
gzip -dc "${release_dir}/synapse-images.tar.gz" | docker load

echo "Starting release ${image_tag}"
if ! "${compose[@]}" "${compose_files[@]}" up -d --no-build --remove-orphans --wait --wait-timeout 600; then
  echo "Release ${image_tag} failed health checks." >&2
  "${compose[@]}" "${compose_files[@]}" ps || true
  "${compose[@]}" "${compose_files[@]}" logs --tail=200 api web || true

  if [[ -s "${previous_env}" ]]; then
    echo "Rolling back to the previous release." >&2
    cp "${previous_env}" "${current_env}"
    "${compose[@]}" "${compose_files[@]}" up -d --no-build --remove-orphans --wait --wait-timeout 600
  else
    "${compose[@]}" "${compose_files[@]}" down --remove-orphans
  fi
  exit 1
fi

cp "${new_env}" "${current_env}"
rm -f "${release_dir}/synapse-images.tar.gz"
"${compose[@]}" "${compose_files[@]}" ps
echo "Release ${image_tag} is healthy."
