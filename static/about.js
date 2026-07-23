const params = new URLSearchParams(window.location.search)

document.querySelector('#app-version').textContent = params.get('appVersion')
document.querySelector('#webtorrent-version').textContent = params.get('webtorrentVersion')
document.querySelector('#architecture').textContent = params.get('architecture')
document.querySelector('#copyright').textContent = params.get('copyright')
