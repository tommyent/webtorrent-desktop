const React = require('react')

const ModalOKCancel = require('./modal-ok-cancel')
const { Checkbox } = require('./controls')
const { dispatch, dispatcher } = require('../lib/dispatcher')

module.exports = class RemoveTorrentModal extends React.Component {
  render () {
    const state = this.props.state
    // torrentKeys: the rows checked for the header's Remove button
    const { torrentKeys, deleteData } = state.modal
    const count = torrentKeys ? torrentKeys.length : 1
    const what = count === 1 ? 'this torrent' : `these ${count} torrents`
    const message = deleteData
      ? `Are you sure you want to remove ${what} from the list and delete the data ${count === 1 ? 'file' : 'files'}?`
      : `Are you sure you want to remove ${what} from the list?`
    const buttonText = deleteData ? 'REMOVE DATA' : 'REMOVE'

    return (
      <div>
        <p><strong>{message}</strong></p>
        {torrentKeys && (
          <p>
            <Checkbox
              label='Also delete the downloaded files'
              checked={deleteData}
              onCheck={(e, checked) => {
                state.modal.deleteData = checked
                dispatch('update')
              }}
            />
          </p>
        )}
        <ModalOKCancel
          cancelText='CANCEL'
          onCancel={dispatcher('exitModal')}
          okText={buttonText}
          onOK={handleRemove}
        />
      </div>
    )

    function handleRemove () {
      if (torrentKeys) dispatch('deleteTorrents', torrentKeys, deleteData)
      else dispatch('deleteTorrent', state.modal.infoHash, deleteData)
      dispatch('exitModal')
    }
  }
}
