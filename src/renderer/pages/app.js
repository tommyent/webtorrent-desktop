const createGetter = require('fn-getter')
const React = require('react')

const Header = require('../components/header')
const config = require('../lib/config')

// Perf optimization: Needed immediately, so do not lazy load it below
const TorrentListPage = require('./torrent-list-page')

const Views = {
  home: createGetter(() => TorrentListPage),
  player: createGetter(() => require('./player-page')),
  'create-torrent': createGetter(() => require('./create-torrent-page')),
  preferences: createGetter(() => require('./preferences-page'))
}

const Modals = {
  'open-torrent-address-modal': createGetter(
    () => require('../components/open-torrent-address-modal')
  ),
  'remove-torrent-modal': createGetter(() => require('../components/remove-torrent-modal')),
  'update-available-modal': createGetter(() => require('../components/update-available-modal')),
  'unsupported-media-modal': createGetter(() => require('../components/unsupported-media-modal')),
  'delete-all-torrents-modal':
      createGetter(() => require('../components/delete-all-torrents-modal'))
}

class App extends React.Component {
  render () {
    const state = this.props.state

    // Hide player controls while playing video, if the mouse stays still for a while
    // Never hide the controls when:
    // * The mouse is over the controls or we're scrubbing (see CSS)
    // * The video is paused
    // * The video is playing remotely on Chromecast or Airplay
    const hideControls = state.shouldHidePlayerControls()

    const cls = [
      'view-' + state.location.url(), /* e.g. view-home, view-player */
      'is-' + config.PLATFORM /* e.g. is-darwin, is-win32, is-linux */
    ]
    if (state.window.isFullScreen) cls.push('is-fullscreen')
    if (state.window.isFocused) cls.push('is-focused')
    if (hideControls) cls.push('hide-video-controls')

    return (
      <div className={'app ' + cls.join(' ')}>
        <Header state={state} />
        {this.getErrorPopover()}
        <div key='content' className='content'>{this.getView()}</div>
        {this.getModal()}
      </div>
    )
  }

  getErrorPopover () {
    const state = this.props.state
    const now = new Date().getTime()
    const recentErrors = state.errors.filter((x) => now - x.time < 5000)
    const hasErrors = recentErrors.length > 0

    const errorElems = recentErrors.map((error, i) => <div key={i} className='error'>{error.message}</div>)
    return (
      <div
        key='errors'
        className={'error-popover ' + (hasErrors ? 'visible' : 'hidden')}
      >
        <div key='title' className='title'>Error</div>
        {errorElems}
      </div>
    )
  }

  getModal () {
    const state = this.props.state
    if (!state.modal) return

    const ModalContents = Modals[state.modal.id]()
    return (
      <div key='modal' className='modal'>
        <div key='modal-background' className='modal-background' />
        <div key='modal-content' className='modal-content'>
          <ModalContents state={state} />
        </div>
      </div>
    )
  }

  getView () {
    const state = this.props.state
    const View = Views[state.location.url()]()
    return (<View state={state} />)
  }
}

module.exports = App
