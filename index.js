const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs')

module.exports = {
  extend: '@apostrophecms/piece-type',
  bundle: {
    directory: 'modules',
    modules: getBundleModuleNames()
  },
  options: {
    label: 'Event',
    pluralLabel: 'Events',
    sort: { start: 1 },
  },
  filters: {
    add: {
      upcoming: {
        label: 'Upcoming',
        choices: [
          {
            value: true,
            label: 'Upcoming'
          }, {
            value: false,
            label: 'Past'
          }, {
            value: null,
            label: 'Both'
          }
        ],
        def: true,
      }
    }
  },
  columns: {
    add: {
      start: {
        label: 'Start'
      }
    }
  },
  fields: {
    add: {
      startDate: {
        label: 'Start date',
        type: 'date',
        required: true
      },
      allDay: {
        label: 'Is this an all day event?',
        type: 'boolean',
        choices: [
          {
            label: 'Yes',
            value: true
          },
          {
            label: 'No',
            value: false,
            showFields: ['startTime', 'endTime']
          }
        ],
        def: false
      },
      startTime: {
        label: 'Start time',
        type: 'time',
        def: '09:00 AM',
        required: true,
        if: {
          allDay: false
        }
      },
      endTime: {
        label: 'End time',
        type: 'time',
        def: '05:30 PM',
        required: true,
        if: {
          allDay: false
        }
      },
      dateType: {
        label: 'What type of event is this?',
        help: 'Select if the event is on a single day, consecutive days, or repeats.',
        type: 'select',
        choices: [
          {
            label: 'Single Day',
            value: 'single'
          },
          {
            label: 'Consecutive Days',
            value: 'consecutive'
          },
          {
            label: 'Recurring',
            value: 'repeat',
          }
        ],
        def: 'single'
      },
      enddate: {
        label: 'End date',
        type: 'date',
        if: {
          dateType: 'consecutive'
        }
      },
      repeatInterval: {
        label: 'How often does the event repeat?',
        type: 'select',
        choices: [
          {
            label: 'Every week',
            value: 'weeks'
          },
          {
            label: 'Every month',
            value: 'months'
          }
        ],
        if: {
          dateType: 'repeat'
        }
      },
      repeatCount: {
        label: 'How many times does it repeat?',
        type: 'integer',
        def: 1,
        if: {
          dateType: 'repeat'
        }
      },
      description: {
        type: 'string',
        label: 'Description',
        textarea: true,
        required: true
      },
      image: {
        label: 'Headline photo',
        type: 'area',
        options: {
          max: 1,
          widgets: {
            '@apostrophecms/image': {}
          }
        },
        required: false
      }
    },
    group: {
      basics: {
        label: 'Basics',
        fields: ['title', 'slug', 'description', 'image', 'startDate', 'allDay', 'startTime', 'endTime']
      },
      advanced: {
        label: 'Advanced',
        fields: ['dateType', 'enddate', 'repeatInterval', 'repeatCount']
      },
      meta: {
        label: 'Meta',
        fields: ['tags', 'published']
      }
    }
  },
  handlers(self, options) {
    return {
      beforeSave: {
        async denormalizeDateTimes(req, piece, options) {
          self.denormalizeDatesAndTimes(piece)
        }
      },
      beforeInsert: {
        setGroupId(req, piece, options) {
          // Set groupId on parent if this is a repeating item
          if (piece.dateType === 'repeat' && !piece.groupId && !self._workflowPropagating) {
            piece.groupId = self.apos.util.generateId()
          }
        }
      },
      afterInsert: {
        async createRepeatItems(req, piece, options) {
          if (self._workflowPropagating) {
            // Workflow is replicating this but also its existing
            // scheduled repetitions, don't re-replicate them and cause problems
            return
          }
          if (piece.dateType === 'repeat' && piece.aposMode === 'draft') {
            await self.repeatEvent(req, piece, options)
            return
          } else {
            return
          }
        }
      },
      afterPublish: {
        async publishChildren(req, piece, options) {
          // If this is a repeating item, publish its children also
          if (piece.published.dateType === 'repeat' && piece.firstTime) {
            const existing = await self.findChildren(req, {
              groupId: piece.draft.groupId
            })
            for (const child of existing) {
              if (!child.isClone) continue // Skip the parent event
              await self.publish(req, child, options)
            }
          }
        }
      }
    }
  },
  methods(self, options) {
    return {
      denormalizeDatesAndTimes(piece) {
        // Parse our dates and times
        let startTime = piece.startTime
        let startDate = piece.startDate
        let endTime = piece.endTime
        let enddate

        if (piece.dateType === 'consecutive') {
          enddate = piece.enddate
        } else {
          piece.enddate = piece.startDate
          enddate = piece.startDate
        }

        if (piece.allDay) {
          startTime = '00:00:00'
          endTime = '23:59:59'
        }

        if (piece.dateType === 'repeat') {
          piece.hasClones = true
        }

        piece.start = new Date(startDate + ' ' + startTime)
        piece.end = new Date(enddate + ' ' + endTime)
      },
      async repeatEvent(req, piece, options) {
        let i
        let repeat = parseInt(piece.repeatCount) + 1
        let multiplier = piece.repeatInterval
        let addDates = []

        for (i = 1; i < repeat; i++) {
          addDates.push(dayjs(piece.startDate).add(i, multiplier).format('YYYY-MM-DD'))
        }

        let eventCopy
        for (const newDate of addDates) {
          eventCopy = { ...piece }
          eventCopy._id = null
          eventCopy.aposDocId = null
          eventCopy.isClone = true
          eventCopy.hasClones = false
          eventCopy.startDate = newDate
          eventCopy.endDate = newDate
          eventCopy.slug = eventCopy.slug + '-' + newDate
          eventCopy.dateType = 'single'
          self.denormalizeDatesAndTimes(eventCopy)
          await self.insert(req, eventCopy, options)
        }
        return
      },
      async findChildren(req, criteria) {
        const query = await self.find(req, criteria)
        const objArray = await query.toArray()
        return objArray
      }
    }
  },
  queries(self, query) {
    return {
      builders: {
        upcoming: {
          async finalize() {
            console.log('Query', query.upcoming)
            // Make sure this filter was actually invoked first
            if (query.get('upcoming')) {
              if (query.upcoming === null) {
                return;
              }

              if (query.upcoming) {
                query.and({
                  end: { $gt: new Date() }
                })
              } else {
                query.and({
                  end: { $lte: new Date() }
                })
              }
            }
          },
          launder(value) {
            return self.apos.launder.boolean(value);
          },
          // Always provides these two choices when requested, even if no docs
          // match either value.
          choices() {
            return [
              { value: null, label: 'All' },
              { value: true, label: 'Upcoming' },
              { value: false, label: 'Past' }
            ];
          }
        }
      }
    }
  }
}

function getBundleModuleNames() {
  const source = path.join(__dirname, './modules/@apostrophecms');
  return fs
    .readdirSync(source, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => `@apostrophecms/${dirent.name}`);
}
