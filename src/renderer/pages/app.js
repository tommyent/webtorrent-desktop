const createGetter = require('fn-getter')
const React = require('react')

const Header = require('../components/header')
const config = require('../lib/config')
const { dispatch } = require('../lib/dispatcher')

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
  'unsupported-media-modal': createGetter(() => require('../components/unsupported-media-modal')),
  'delete-all-torrents-modal':
      createGetter(() => require('../components/delete-all-torrents-modal'))
}

class App extends React.Component {
  render () {
    const state = this.props.state

    if (state.engineStopped) {
      const errors = state.errors.filter(error => error.time >= state.engineStoppedAt)
      return (
        <div className='app engine-stopped' role='alert'>
          <h2>The torrent engine stopped</h2>
          <p>Downloads and playback are unavailable. Restart WebTorrent to continue.</p>
          {errors.length > 0 && <p>{errors[errors.length - 1].message}</p>}
          <button type='button' className='btn raised' onClick={() => dispatch('restartAfterEngineFailure')}>
            Restart WebTorrent
          </button>
        </div>
      )
    }

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
    if (state.errors.length === 0) return null
    const errorElems = state.errors.map((error, i) => <div key={i} className='error'>{error.message}</div>)
    return (
      <div key='errors' className='error-popover'>
        <div className='title'>
          <span>Error</span>
          <button type='button' onClick={() => dispatch('copyErrors')}>
            {state.errorsCopied === state.errors.map(error => error.message).join('\n\n') ? 'Copied' : 'Copy details'}
          </button>
          <button type='button' onClick={() => dispatch('dismissErrors')}>Dismiss</button>
        </div>
        <div className='error-messages' role='alert'>{errorElems}</div>
      </div>
    )
  }

  getModal () {
    const state = this.props.state
    if (!state.modal) return

    const ModalContents = Modals[state.modal.id]()
    return (
      <dialog
        key='modal' className='modal' aria-label='Torrent dialog'
        ref={node => { if (node && !node.open) node.showModal() }}
        onCancel={event => { event.preventDefault(); dispatch('exitModal') }}
      >
        <div key='modal-background' className='modal-background' />
        <div key='modal-content' className='modal-content'>
          <ModalContents state={state} />
        </div>
      </dialog>
    )
  }

  getView () {
    const state = this.props.state
    const View = Views[state.location.url()]()
    return (<View state={state} />)
  }
}

module.exports = App
